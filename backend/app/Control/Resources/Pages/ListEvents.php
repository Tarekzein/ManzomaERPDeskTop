<?php

namespace App\Control\Resources\Pages;

use App\Control\Resources\EventResource;
use Filament\Resources\Pages\ListRecords;

class ListEvents extends ListRecords
{
    protected static string $resource = EventResource::class;
}
