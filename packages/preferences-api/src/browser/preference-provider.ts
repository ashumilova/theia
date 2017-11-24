/*
 * Copyright (C) 2017 Ericsson and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { Disposable, Event } from '@theia/core/lib/common';

export interface NewPreferencesEvent { }
export const PreferenceProvider = Symbol('PreferenceProvider');

export interface PreferenceProvider extends Disposable {
    getPreferences(): { [key: string]: any };
    /* To get rid of the dependency loop problem */
    init(): Promise<void>;
    onNewPreferences: Event<NewPreferencesEvent>;
    ready: Promise<void>;
}
