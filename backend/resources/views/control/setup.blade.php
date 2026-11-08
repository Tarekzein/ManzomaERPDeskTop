<!doctype html>
<html lang="{{ app()->getLocale() }}" dir="{{ app()->getLocale() === 'ar' ? 'rtl' : 'ltr' }}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Manzoma · {{ __('control.setup_title') }}</title><link rel="stylesheet" href="{{ asset('css/control-font.css') }}">
<style>*{box-sizing:border-box}body{margin:0;background:#f4f5f8;color:#202a3b;font:14px Cairo,system-ui,sans-serif;line-height:1.7}.wrap{width:min(560px,calc(100% - 32px));margin:7vh auto;background:#fff;border:1px solid #e2e6ef;border-radius:16px;padding:30px;box-shadow:0 12px 35px #1924380a}h1{margin:4px 0;font-size:24px}p{color:#637086}label{display:grid;gap:6px;margin-top:16px;font-weight:600}input{width:100%;padding:11px 12px;border:1px solid #bec7d8;border-radius:8px;font:inherit;color:inherit}input:focus{outline:2px solid #485e8b;outline-offset:2px}button{margin-top:22px;width:100%;padding:12px;background:#485e8b;color:white;border:0;border-radius:8px;font:600 14px Cairo,system-ui;cursor:pointer}.errors{background:#fbeceb;color:#b4322a;padding:12px;border-radius:8px}small{color:#637086}strong{color:#485e8b}</style></head>
<body><main class="wrap"><strong>{{ __('control.brand') }}</strong><h1>{{ __('control.setup_title') }}</h1><p>{{ __('control.setup_intro') }}</p>
@if($errors->any())<div class="errors" role="alert">@foreach($errors->all() as $error)<div>{{ $error }}</div>@endforeach</div>@endif
<form method="POST" action="{{ route('control.setup.store') }}">@csrf
<label>{{ __('control.name') }}<input name="name" required maxlength="120" value="{{ old('name') }}" autocomplete="name" autofocus></label>
<label>{{ __('control.email') }}<input name="email" type="email" dir="ltr" required maxlength="255" value="{{ old('email') }}" autocomplete="username"></label>
<label>{{ __('control.setup_password') }}<input name="password" type="password" dir="ltr" required minlength="12" maxlength="200" autocomplete="new-password"></label>
<label>{{ __('control.setup_confirm') }}<input name="password_confirmation" type="password" dir="ltr" required minlength="12" maxlength="200" autocomplete="new-password"></label>
<button type="submit">{{ __('control.setup_submit') }}</button></form><p><small>{{ __('control.setup_local') }}</small></p></main></body></html>
