<?php

namespace App\Control\Resources;

use App\Control\Models\LicensedCompany;
use App\Control\Services\LicenseService;
use Filament\Actions\Action;
use Filament\Resources\Resource;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;

class CompanyResource extends Resource
{
    protected static ?string $model = LicensedCompany::class;

    public static function getNavigationLabel(): string
    {
        return __('control.companies');
    }

    public static function getModelLabel(): string
    {
        return __('control.company');
    }

    public static function getPluralModelLabel(): string
    {
        return __('control.companies');
    }

    public static function getEloquentQuery(): Builder
    {
        return parent::getEloquentQuery()->with(['registration', 'device', 'license']);
    }

    public static function table(Table $table): Table
    {
        return $table->columns([TextColumn::make('name')->label(__('control.name'))->searchable()->formatStateUsing(fn ($state, $record) => $record->mode === 'offline' && ! $record->registered_at ? __('control.unused_capacity') : $state), TextColumn::make('license.customer_name')->label(__('control.license_customer')), TextColumn::make('mode')->label(__('control.mode'))->formatStateUsing(fn ($state) => __('control.mode_'.$state))->badge(), TextColumn::make('company_key')->label(__('control.company_key')), TextColumn::make('device.name')->label(__('control.owning_device')), TextColumn::make('registration.status')->label(__('control.provisioning_status'))->formatStateUsing(fn ($state) => __('control.provisioning_'.$state))->badge(), TextColumn::make('registered_at')->label(__('control.registered_at'))->dateTime('d/m/Y H:i')->timezone('Africa/Cairo'), TextColumn::make('device.last_seen_at')->label(__('control.last_seen_at'))->since(), TextColumn::make('reserved_until')->label(__('control.reserved_until'))->dateTime('d/m/Y H:i')->timezone('Africa/Cairo')])->filters([SelectFilter::make('registration_state')->label(__('control.registration_state'))->options(['registered' => __('control.registered'), 'reserved' => __('control.reserved')])->default('registered')->query(fn (Builder $query, array $data) => match ($data['value'] ?? null) {
            'registered' => $query->whereNotNull('registered_at'), 'reserved' => $query->whereNull('registered_at'), default => $query
        })])->recordActions([Action::make('release')->label(__('control.release'))->color('danger')->requiresConfirmation()->modalDescription(__('control.release_help'))->action(fn ($record) => app(LicenseService::class)->releaseCompany($record))])->defaultSort('updated_at', 'desc');
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
        return ['index' => Pages\ListCompanies::route('/')];
    }
}
