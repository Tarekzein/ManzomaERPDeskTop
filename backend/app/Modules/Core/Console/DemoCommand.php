<?php

namespace App\Modules\Core\Console;

use App\Models\User;
use App\Modules\Core\Services\DemoDataService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Auth;

class DemoCommand extends Command
{
    protected $signature = 'erp:demo';

    protected $description = 'Load demonstration data into an installed company';

    public function handle(DemoDataService $demo): int
    {
        $admin = User::role('admin')->firstOrFail();
        Auth::setUser($admin);
        $demo->seed();
        $this->info('Demo data loaded.');

        return self::SUCCESS;
    }
}
