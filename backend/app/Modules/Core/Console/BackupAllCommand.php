<?php

namespace App\Modules\Core\Console;

use App\Modules\Core\Http\Middleware\SelectCompany;
use Illuminate\Console\Command;
use Symfony\Component\Process\Process;

class BackupAllCommand extends Command
{
    protected $signature = 'erp:backup-all';

    protected $description = 'Create isolated database/evidence backups for registered server companies';

    public function handle(): int
    {
        if (! config('erp.multi_company')) {
            return $this->call('erp:backup', ['--bundle' => true]);
        }
        $failed = false;
        foreach (SelectCompany::companies() as $company) {
            $process = new Process([PHP_BINARY, base_path('artisan'), 'erp:backup', '--bundle', '--company='.$company['slug']], base_path());
            $process->setTimeout(900);
            $process->run();
            if (! $process->isSuccessful()) {
                $failed = true;
                $this->error($company['slug'].': '.$process->getErrorOutput());
            }
        }

        return $failed ? self::FAILURE : self::SUCCESS;
    }
}
