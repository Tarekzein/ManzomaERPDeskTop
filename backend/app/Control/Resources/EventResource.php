<?php

namespace App\Control\Resources;

use App\Control\Models\LicenseEvent;
use Filament\Resources\Resource;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;

class EventResource extends Resource
{
    protected static ?string $model = LicenseEvent::class;

    public static function getNavigationLabel(): string
    {
        return __('control.events');
    }

    public static function getModelLabel(): string
    {
        return __('control.event_record');
    }

    public static function getPluralModelLabel(): string
    {
        return __('control.events');
    }

    public static function table(Table $table): Table
    {
        return $table->columns([TextColumn::make('created_at')->label(__('control.created_at'))->dateTime('d/m/Y H:i')->timezone('Africa/Cairo'), TextColumn::make('license_id')->label(__('control.license_id')), TextColumn::make('actor_id')->label(__('control.actor_id')), TextColumn::make('event')->label(__('control.event'))->formatStateUsing(fn ($state) => trans()->has('control.event_'.$state) ? __('control.event_'.$state) : $state)->tooltip(fn ($record) => $record->event)->searchable(), TextColumn::make('details')->label(__('control.details'))->state(fn ($record) => json_encode($record->details, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES))->wrap()])->defaultSort('created_at', 'desc');
    }

    public static function canCreate(): bool
    {
        return false;
    }

    public static function canEdit($record): bool
    {
        return false;
    }

    public static function canDelete($record): bool
    {
        return false;
    }

    public static function getPages(): array
    {
        return ['index' => Pages\ListEvents::route('/')];
    }
}
