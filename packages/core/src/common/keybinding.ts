/*
 * Copyright (C) 2017 TypeFox and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { injectable, inject, named } from 'inversify';
import { CommandRegistry } from './command';
import { KeyCode } from './keys';
import { ContributionProvider } from './contribution-provider';
import { ILogger } from "./logger";

export enum KeybindingScope {
    DEFAULT,
    USER,
    WORKSPACE,
    END
}

export namespace Keybinding {

    /**
     * Returns with the string representation of the binding.
     * Any additional properties which are not described on
     * the `Keybinding` API will be ignored.
     *
     * @param binding the binding to stringify.
     */
    export function stringify(binding: Keybinding): string {
        const copy: Keybinding = {
            command: binding.command,
            keybinding: binding.keybinding,
            context: binding.context
        };
        return JSON.stringify(copy);
    }
}

export interface Keybinding {
    /* Command identifier, this needs to be a unique string.  */
    command: string;
    /* Keybinding string as defined in packages/keymaps/README.md.  */
    keybinding: string;
    /**
     * The optional keybinding context where this binding belongs to.
     * If not specified, then this keybinding context belongs to the NOOP
     * keybinding context.
     */
    context?: string;
}

export const KeybindingContribution = Symbol("KeybindingContribution");
export interface KeybindingContribution {
    registerKeybindings(keybindings: KeybindingRegistry): void;
}

export const KeybindingContext = Symbol("KeybindingContextExtension");
export interface KeybindingContext {
    /**
     * The unique ID of the current context.
     */
    readonly id: string;

    isEnabled(arg: Keybinding): boolean;
}
export namespace KeybindingContexts {

    export const NOOP_CONTEXT: KeybindingContext = {
        id: 'noop.keybinding.context',
        isEnabled: () => true
    };

    export const DEFAULT_CONTEXT: KeybindingContext = {
        id: 'default.keybinding.context',
        isEnabled: () => false
    };
}

@injectable()
export class KeybindingContextRegistry {

    protected readonly contexts: { [id: string]: KeybindingContext } = {};

    constructor(
        @inject(ContributionProvider) @named(KeybindingContext)
        protected readonly contextProvider: ContributionProvider<KeybindingContext>
    ) {
        this.registerContext(KeybindingContexts.NOOP_CONTEXT);
        this.registerContext(KeybindingContexts.DEFAULT_CONTEXT);
    }

    initialize(): void {
        this.contextProvider.getContributions().forEach(context => this.registerContext(context));
    }

    /**
     * Registers the keybinding context arguments into the application. Fails when an already registered
     * context is being registered.
     *
     * @param contexts the keybinding contexts to register into the application.
     */
    registerContext(...contexts: KeybindingContext[]) {
        for (const context of contexts) {
            const { id } = context;
            if (this.contexts[id]) {
                throw new Error(`A keybinding context with ID ${id} is already registered.`);
            }
            this.contexts[id] = context;
        }
    }

    getContext(contextId: string): KeybindingContext | undefined {
        return this.contexts[contextId];
    }
}

@injectable()
export class KeybindingRegistry {

    private keymaps: Keybinding[][] = [];
    static readonly PASSTHROUGH_PSEUDO_COMMAND = "passthrough";

    constructor(
        @inject(CommandRegistry) protected readonly commandRegistry: CommandRegistry,
        @inject(KeybindingContextRegistry) protected readonly contextRegistry: KeybindingContextRegistry,
        @inject(ContributionProvider) @named(KeybindingContribution)
        protected readonly contributions: ContributionProvider<KeybindingContribution>,
        @inject(ILogger) protected readonly logger: ILogger
    ) {
        for (let i = KeybindingScope.DEFAULT; i < KeybindingScope.END; i++) { this.keymaps.push([]); }
    }

    onStart(): void {
        for (const contribution of this.contributions.getContributions()) {
            contribution.registerKeybindings(this);
        }
    }

    registerKeybindings(...bindings: Keybinding[]): void {
        for (const binding of bindings) {
            this.registerKeybinding(binding);
        }
    }

    /**
     * Register a default keybinding to the registry.
     *
     * @param binding
     */
    registerKeybinding(binding: Keybinding) {
        try {
            const existingBindings = this.getKeybindingsForKeyCode(KeyCode.parse(binding.keybinding));
            if (existingBindings.length > 0) {
                const collided = existingBindings.filter(b => b.context === binding.context);
                if (collided.length > 0) {
                    this.logger.warn('Collided keybinding is ignored; ',
                        Keybinding.stringify(binding), ' collided with ',
                        collided.map(b => Keybinding.stringify(b)).join(', '));
                    return;
                }
            }
            this.keymaps[KeybindingScope.DEFAULT].push(binding);
        } catch (error) {
            this.logger.warn(`Could not register keybinding ${Keybinding.stringify(binding)}`);
        }
    }

    /**
     * Get the keybindings associated to commandId.
     *
     * @param commandId The ID of the command for which we are looking for keybindings.
     */
    getKeybindingsForCommand(commandId: string): Keybinding[] {
        const result: Keybinding[] = [];

        for (let scope = KeybindingScope.END - 1; scope >= KeybindingScope.DEFAULT; scope--) {
            this.keymaps[scope].forEach(binding => {
                const command = this.commandRegistry.getCommand(binding.command);
                if (command) {
                    if (command.id === commandId) {
                        result.push(binding);
                    }
                }
            });

            if (result.length > 0) {
                return result;
            }
        }
        return result;
    }

    /**
     * Get the list of keybindings matching keyCode.  The list is sorted by
     * priority (see #sortKeybindingsByPriority).
     *
     * @param keyCode The key code for which we are looking for keybindings.
     */
    getKeybindingsForKeyCode(keyCode: KeyCode): Keybinding[] {
        const result: Keybinding[] = [];

        for (let scope = KeybindingScope.DEFAULT; scope < KeybindingScope.END; scope++) {
            this.keymaps[scope].forEach(binding => {
                try {
                    const bindingKeyCode = KeyCode.parse(binding.keybinding);
                    if (KeyCode.equals(bindingKeyCode, keyCode)) {
                        if (!this.isKeybindingShadowed(scope, binding)) {
                            result.push(binding);
                        }
                    }
                } catch (error) {
                    this.logger.warn(error);
                }
            });
        }
        this.sortKeybindingsByPriority(result);
        return result;
    }

    /**
     * Returns a list of keybindings for a command in a specific scope
     * @param scope specific scope to look for
     * @param commandId unique id of the command
     */
    getScopedKeybindingsForCommand(scope: KeybindingScope, commandId: string): Keybinding[] {
        const result: Keybinding[] = [];

        if (scope >= KeybindingScope.END) {
            return [];
        }

        this.keymaps[scope].forEach(binding => {
            const command = this.commandRegistry.getCommand(binding.command);
            if (command && command.id === commandId) {
                result.push(binding);
            }
        });
        return result;
    }

    /**
     * Returns true if a keybinding is shadowed in a more specific scope i.e bound in user scope but remapped in
     * workspace scope means the user keybinding is shadowed.
     * @param scope scope of the current keybinding
     * @param binding keybinding that will be checked in more specific scopes
     */
    isKeybindingShadowed(scope: KeybindingScope, binding: Keybinding): boolean {
        if (scope >= KeybindingScope.END) {
            return false;
        }

        const nextScope = ++scope;

        if (this.getScopedKeybindingsForCommand(nextScope, binding.command).length > 0) {
            return true;
        }
        return this.isKeybindingShadowed(nextScope, binding);
    }

    /**
     * Sort keybindings in-place, in order of priority.
     *
     * The only criterion right now is that a keybinding with a context has
     * more priority than a keybinding with no context.
     *
     * @param keybindings Array of keybindings to be sorted in-place.
     */
    private sortKeybindingsByPriority(keybindings: Keybinding[]) {
        keybindings.sort((a: Keybinding, b: Keybinding): number => {

            let acontext: KeybindingContext | undefined;
            if (a.context) {
                acontext = this.contextRegistry.getContext(a.context);
            }

            let bcontext: KeybindingContext | undefined;
            if (b.context) {
                bcontext = this.contextRegistry.getContext(b.context);
            }

            if (acontext && !bcontext) {
                return -1;
            }

            if (!acontext && bcontext) {
                return 1;
            }

            return 0;
        });
    }

    protected isActive(binding: Keybinding): boolean {
        /* Pseudo commands like "passthrough" are always active (and not found
           in the command registry).  */
        if (this.isPseudoCommand(binding.command)) {
            return true;
        }

        const command = this.commandRegistry.getCommand(binding.command);
        return !!command && !!this.commandRegistry.getActiveHandler(command.id);
    }

    /**
     * Run the command matching to the given keyboard event.
     */
    run(event: KeyboardEvent): void {
        if (event.defaultPrevented) {
            return;
        }

        const keyCode = KeyCode.createKeyCode(event);
        const bindings = this.getKeybindingsForKeyCode(keyCode);

        for (const binding of bindings) {
            const context = binding.context
                ? this.contextRegistry.getContext(binding.context)
                : undefined;

            /* Only execute if it has no context (global context) or if we're in
               that context.  */
            if (!context || context.isEnabled(binding)) {

                if (this.isPseudoCommand(binding.command)) {
                    /* Don't do anything, let the event propagate.  */
                } else {
                    const command = this.commandRegistry.getCommand(binding.command);
                    if (command) {
                        const commandHandler = this.commandRegistry.getActiveHandler(command.id);

                        if (commandHandler) {
                            commandHandler.execute();
                        }

                        /* Note that if a keybinding is in context but the command is
                           not active we still stop the processing here.  */
                        event.preventDefault();
                        event.stopPropagation();
                    }
                }

                break;
            }
        }
    }

    /* Return true of string a pseudo-command id, in other words a command id
       that has a special meaning and that we won't find in the command
       registry.  */

    isPseudoCommand(commandId: string): boolean {
        return commandId === KeybindingRegistry.PASSTHROUGH_PSEUDO_COMMAND;
    }

    setKeymap(scope: KeybindingScope, keybindings: Keybinding[]) {
        const customBindings: Keybinding[] = [];
        for (const keybinding of keybindings) {
            try {
                // This will throw if the keybinding is invalid.
                KeyCode.parse(keybinding.keybinding);
                customBindings.push(keybinding);
            } catch (error) {
                this.logger.warn(`Invalid keybinding, keymap reset`);
                this.resetKeybindingsForScope(scope);
                return;
            }
        }
        this.keymaps[scope] = customBindings;
    }

    /**
     * Reset keybindings for a specific scope
     * @param scope scope to reset the keybindings for
     */
    resetKeybindingsForScope(scope: KeybindingScope) {
        this.keymaps[scope] = [];
    }

    /**
     * Reset keybindings for all scopes(only leaves the default keybindings mapped)
     */
    resetKeybindings() {
        for (let i = KeybindingScope.DEFAULT + 1; i < KeybindingScope.END; i++) {
            this.keymaps[i] = [];
        }
    }
}
