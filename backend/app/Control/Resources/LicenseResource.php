<?php

namespace App\Control\Resources;

use App\Control\Models\License;
use App\Control\Services\LicenseService;
use App\Modules\Core\Http\Middleware\SelectCompany;
use Filament\Actions\Action;
use Filament\Actions\ActionGroup;
use Filament\Actions\EditAction;
use Filament\Forms\Components\DateTimePicker;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Infolists\Components\TextEntry;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;

class LicenseResource extends Resource
{
    protected static ?string $model = License::class;

    public static function getNavigationLabel(): string
    {
        return __('control.licenses');
    }

    public static function getModelLabel(): string
    {
        return __('control.license');
    }

    public static function getPluralModelLabel(): string
    {
        return __('control.licenses');
    }

    public static function getEloquentQuery(): Builder
    {
        return parent::getEloquentQuery()->withCount('companies')->withCount(['devices as occupied_devices_count' => fn ($query) => $query->where(fn ($q) => $q->where('status', 'active')->orWhere('offline_reserved_until', '>', now()))]);
    }

    public static function form(Schema $schema): Schema
    {
        return $schema->components([
            TextInput::make('customer_name')->label(__('control.customer_name'))->required()->maxLength(150), TextInput::make('email')->label(__('control.email'))->email(),
            Select::make('mode')->label(__('control.mode'))->options(['online' => __('control.mode_online'), 'offline' => __('control.mode_offline'), 'hybrid' => __('control.mode_hybrid')])->required()->default('hybrid')->live(),
            Select::make('status')->label(__('control.status'))->options(['active' => __('control.status_active'), 'suspended' => __('control.status_suspended'), 'revoked' => __('control.status_revoked')])->required()->default('active'),
            TextInput::make('max_companies')->label(__('control.max_companies'))->helperText(__('control.one_company_per_device'))->numeric()->minValue(1)->required()->default(1), TextInput::make('max_devices')->label(__('control.max_devices'))->numeric()->minValue(1)->required()->default(1),
            DateTimePicker::make('expires_at')->label(__('control.expires_at'))->timezone('Africa/Cairo')->required()->default(now()->addYear()), Textarea::make('notes')->label(__('control.notes'))->columnSpanFull(),
        ]);
    }

    public static function table(Table $table): Table
    {
        return $table->columns([
            TextColumn::make('customer_name')->label(__('control.customer_name'))->searchable(), TextColumn::make('mode')->label(__('control.mode'))->formatStateUsing(fn ($state) => __('control.mode_'.$state))->badge(), TextColumn::make('status')->label(__('control.status'))->formatStateUsing(fn ($state) => __('control.status_'.$state))->badge(),
            TextColumn::make('registered_companies_count')->counts('registeredCompanies')->label(__('control.company_usage'))->formatStateUsing(fn ($state, License $record) => $state.' / '.$record->max_companies)->extraCellAttributes(['dir' => 'ltr'])->tooltip(__('control.usage_hint')),
            TextColumn::make('reserved_companies_count')->counts('reservedCompanies')->label(__('control.unused_reservations'))->tooltip(__('control.reservations_help')),
            TextColumn::make('free_companies')->label(__('control.free_capacity'))->state(fn (License $record) => max(0, $record->max_companies - $record->companies_count)),
            TextColumn::make('occupied_devices_count')->label(__('control.device_usage'))->formatStateUsing(fn ($state, License $record) => $state.' / '.$record->max_devices)->extraCellAttributes(['dir' => 'ltr'])->tooltip(__('control.usage_hint')),
            TextColumn::make('expires_at')->label(__('control.expires_at'))->dateTime('d/m/Y H:i')->timezone('Africa/Cairo')->sortable(),
        ])->recordActions([ActionGroup::make([
            EditAction::make()->using(fn (License $record, array $data) => app(LicenseService::class)->save($data, $record)),
            Action::make('activation')->label(__('control.activation'))->modalDescription(__('control.activation_help'))
                ->schema([TextEntry::make('activation_key')->label(__('control.activation_key'))->state(fn (License $record) => app(LicenseService::class)->activationKey($record))->copyable()->copyMessage(__('control.copied'))->extraAttributes(['dir' => 'ltr', 'style' => 'overflow-wrap:anywhere;font-family:monospace'])])
                ->modalSubmitAction(false)->modalCancelActionLabel(__('control.close'))
                ->mountUsing(function (License $record, Schema $schema) {
                    $schema->fill();
                    app(LicenseService::class)->audit($record->id, 'activation.viewed');
                }),
            Action::make('online')->visible(fn (License $record) => $record->mode !== 'offline')->label(__('control.online'))->schema([Select::make('slug')->label(__('control.slug'))->options(fn () => collect(config('erp.multi_company') ? SelectCompany::companies() : [['slug' => 'default', 'name' => config('app.name')]])->pluck('name', 'slug')->all())->required()])->action(fn (License $record, array $data) => app(LicenseService::class)->bindOnline($record, $data['slug'])),
        ])->label(__('control.manage'))->button()])->defaultSort('created_at', 'desc');
    }

    public static function getPages(): array
    {
        return ['index' => Pages\ManageLicenses::route('/')];
    }
}
