<?php

namespace App\Control\Resources\Pages;

use App\Control\Resources\CompanyResource;
use Filament\Resources\Pages\ListRecords;

class ListCompanies extends ListRecords
{
    protected static string $resource = CompanyResource::class;
}
