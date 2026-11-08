<?php

namespace App\Control\Models;

class CompanyRegistration extends ControlModel
{
    public $incrementing = false;

    protected $keyType = 'string';

    protected $hidden = ['input_hash'];
}
