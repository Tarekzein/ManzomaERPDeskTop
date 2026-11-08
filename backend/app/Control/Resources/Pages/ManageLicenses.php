<?php

namespace App\Control\Resources\Pages;

use App\Control\Resources\LicenseResource;
use App\Control\Services\LicenseService;
use Filament\Actions\CreateAction;
use Filament\Resources\Pages\ManageRecords;

class ManageLicenses extends ManageRecords
{
    protected static string $resource = LicenseResource::class;

    protected function getHeaderActions(): array
    {
        return [CreateAction::make()->using(fn (array $data) => app(LicenseService::class)->save($data))];
    }
}
