<?php

namespace App\Providers\Filament;

use App\Control\Http\ControlLocale;
use App\Control\Http\RequireControlSetup;
use App\Control\Widgets\LicenseStats;
use Filament\Actions\Action;
use Filament\FontProviders\LocalFontProvider;
use Filament\Http\Middleware\Authenticate;
use Filament\Http\Middleware\AuthenticateSession;
use Filament\Http\Middleware\DisableBladeIconComponents;
use Filament\Http\Middleware\DispatchServingFilamentEvent;
use Filament\Pages\Dashboard;
use Filament\Panel;
use Filament\PanelProvider;
use Filament\Support\Colors\Color;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\View\Middleware\ShareErrorsFromSession;

class ControlPanelProvider extends PanelProvider
{
    public function register(): void
    {
        if (config('licensing.control_enabled')) {
            parent::register();
        }
    }

    public function panel(Panel $panel): Panel
    {
        return $panel->default()->id('control')->path('control')->login()->authGuard('control')->brandName(fn () => __('control.brand'))
            ->font('Cairo', url: asset('css/control-font.css'), provider: LocalFontProvider::class)
            ->colors(['primary' => Color::hex('#485e8b')])->discoverResources(in: app_path('Control/Resources'), for: 'App\Control\Resources')
            ->userMenuItems([Action::make('language')->label(fn () => app()->getLocale() === 'ar' ? 'English' : 'العربية')->url(fn () => request()->fullUrlWithQuery(['lang' => app()->getLocale() === 'ar' ? 'en' : 'ar']))])
            ->pages([Dashboard::class])->widgets([LicenseStats::class])
            ->middleware([EncryptCookies::class, AddQueuedCookiesToResponse::class, StartSession::class, AuthenticateSession::class, ShareErrorsFromSession::class, ValidateCsrfToken::class, SubstituteBindings::class, DisableBladeIconComponents::class, DispatchServingFilamentEvent::class, RequireControlSetup::class])
            ->middleware([ControlLocale::class], isPersistent: true)
            ->authMiddleware([Authenticate::class]);
    }
}
