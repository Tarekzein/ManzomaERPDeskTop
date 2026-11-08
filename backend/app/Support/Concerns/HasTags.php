<?php

namespace App\Support\Concerns;

use App\Modules\Core\Models\Tag;
use Illuminate\Database\Eloquent\Relations\MorphToMany;

trait HasTags
{
    public function tags(): MorphToMany
    {
        return $this->morphToMany(Tag::class, 'taggable', 'taggables');
    }

    /**
     * Accepts tag ids or names; unknown names are created.
     */
    public function syncTags(array $tags): void
    {
        $ids = collect($tags)->filter(fn ($t) => $t !== null && $t !== '')->map(function ($tag) {
            if (is_numeric($tag)) {
                return (int) $tag;
            }

            return Tag::firstOrCreate(['name' => trim((string) $tag)])->id;
        })->unique()->values()->all();

        $this->tags()->sync($ids);
    }
}
