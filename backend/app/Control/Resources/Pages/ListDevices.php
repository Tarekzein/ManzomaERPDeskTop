<?php

namespace App\Control\Resources\Pages;

use App\Control\Resources\DeviceResource;
use Filament\Resources\Pages\ListRecords;

class ListDevices extends ListRecords
{
    protected static string $resource = DeviceResource::class;
}
