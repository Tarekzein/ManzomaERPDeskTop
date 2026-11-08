<?php

namespace App\Control\Resources;

use App\Control\Models\LicensedDevice;
use App\Control\Services\LicenseService;
use Filament\Actions\Action;
use Filament\Resources\Resource;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;

class DeviceResource extends Resource
{
    protected static ?string $model = LicensedDevice::class;

    public static function getNavigationLabel(): string
    {
        return __('control.devices');
    }

    public static function getModelLabel(): string
    {
        return __('control.device');
    }

    public static function getPluralModelLabel(): string
    {
        return __('control.devices');
    }

    public static function table(Table $table): Table
    {
        return $table->columns([TextColumn::make('name')->label(__('control.name'))->searchable(), TextColumn::make('id')->label(__('control.device_id'))->limit(16)->copyable(), TextColumn::make('license.customer_name')->label(__('control.license_customer')), TextColumn::make('assignedCompany.name')->label(__('control.assigned_company')), TextColumn::make('status')->label(__('control.status'))->formatStateUsing(fn ($state) => __('control.status_'.$state))->badge(), TextColumn::make('platform')->label(__('control.platform')), TextColumn::make('app_version')->label(__('control.app_version')), TextColumn::make('last_ip')->label(__('control.last_ip')), TextColumn::make('last_seen_at')->label(__('control.last_seen_at'))->dateTime('d/m/Y H:i')->timezone('Africa/Cairo'), TextColumn::make('offline_reserved_until')->label(__('control.offline_reserved_until'))->dateTime('d/m/Y H:i')->timezone('Africa/Cairo')])->recordActions([Action::make('revoke')->label(__('control.revoke'))->color('danger')->requiresConfirmation()->modalDescription(__('control.revoke_help'))->visible(fn ($record) => $record->status === 'active')->action(fn ($record) => app(LicenseService::class)->revokeDevice($record)), Action::make('restore')->label(__('control.restore'))->requiresConfirmation()->visible(fn ($record) => $record->status === 'revoked')->action(fn ($record) => app(LicenseService::class)->restoreDevice($record))])->defaultSort('updated_at', 'desc');
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
        return ['index' => Pages\ListDevices::route('/')];
    }
}
