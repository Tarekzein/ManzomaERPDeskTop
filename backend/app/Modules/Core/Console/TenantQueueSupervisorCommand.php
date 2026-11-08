<?php

namespace App\Modules\Core\Console;

use App\Modules\Core\Http\Middleware\SelectCompany;
use Illuminate\Console\Command;
use Symfony\Component\Process\Process;

/** Each child enters its company before polling jobs; registry discovery never switches a live worker. */
class TenantQueueSupervisorCommand extends Command
{
    protected $signature = 'erp:queue-supervise {--once : Poll one job per company and exit}';

    protected $description = 'Discover and supervise an isolated database worker for every registered company';

    public function handle(): int
    {
        $running = true;
        $workers = [];
        $failed = false;
        if (function_exists('pcntl_signal')) {
            $this->trap([SIGTERM, SIGINT], function () use (&$running) {
                $running = false;
            });
        }
        try {
            do {
                $registry = config('erp.companies_registry');
                if (config('erp.multi_company') && is_file($registry) && ! is_array(json_decode(file_get_contents($registry), true))) {
                    $this->error('Company registry is invalid; workers stopped.');

                    return self::FAILURE;
                }
                $companies = config('erp.multi_company') ? SelectCompany::registered() : [''];
                foreach ($workers as $slug => $worker) {
                    if (! in_array($slug, $companies, true)) {
                        $worker->stop(10);
                        unset($workers[$slug]);
                    }
                }
                foreach ($companies as $slug) {
                    if (isset($workers[$slug]) && $workers[$slug]->isRunning()) {
                        continue;
                    }
                    if (isset($workers[$slug]) && ! $workers[$slug]->isSuccessful()) {
                        $failed = true;
                        $this->error(($slug ?: 'default').': worker exited; restarting isolated worker.');
                    }
                    $args = [PHP_BINARY, base_path('artisan'), 'erp:queue-work'];
                    if ($slug !== '') {
                        $args[] = '--company='.$slug;
                    }
                    if ($this->option('once')) {
                        $args[] = '--once';
                    }
                    $worker = new Process($args, base_path());
                    $worker->setTimeout(null);
                    $worker->start(fn ($type, $buffer) => $this->output->write(($slug ?: 'default').': '.$buffer));
                    $workers[$slug] = $worker;
                }
                if ($this->option('once')) {
                    foreach ($workers as $worker) {
                        $worker->wait();
                        if (! $worker->isSuccessful()) {
                            $failed = true;
                        }
                    }
                    break;
                }
                // Signals interrupt sleep; the container orchestrator restarts this supervisor if it exits.
                sleep(10);
            } while ($running);
        } finally {
            foreach ($workers as $worker) {
                if ($worker->isRunning()) {
                    $worker->stop(10);
                }
            }
        }

        return $failed && $this->option('once') ? self::FAILURE : self::SUCCESS;
    }
}
