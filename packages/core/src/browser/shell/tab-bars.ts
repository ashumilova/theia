/*
 * Copyright (C) 2018 TypeFox and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { TabBar, Title, Widget } from '@phosphor/widgets';
import { VirtualElement, h, VirtualDOM, ElementInlineStyle } from '@phosphor/virtualdom';
import { MenuPath } from '../../common';
import { ContextMenuRenderer } from '../context-menu-renderer';
import { Signal } from '@phosphor/signaling';
import { Message } from '@phosphor/messaging';
import { ArrayExt } from '@phosphor/algorithm';
import { ElementExt } from '@phosphor/domutils';

/** The class name added to hidden content nodes, which are required to render vertical side bars. */
const HIDDEN_CONTENT_CLASS = 'theia-TabBar-hidden-content';

export const SHELL_TABBAR_CONTEXT_MENU: MenuPath = ['shell-tabbar-context-menu'];

export const TabBarRendererFactory = Symbol('TabBarRendererFactory');

export interface SizeData {
    width: number;
    height: number;
}

export interface SideBarRenderData extends TabBar.IRenderData<Widget> {
    labelSize?: SizeData;
    iconSize?: SizeData;
    paddingTop?: number;
    paddingBottom?: number;
}

/**
 * A tab bar renderer that offers a context menu.
 */
export class TabBarRenderer extends TabBar.Renderer {

    tabBar?: TabBar<Widget>;
    contextMenuPath?: MenuPath;

    constructor(protected readonly contextMenuRenderer: ContextMenuRenderer) {
        super();
    }

    renderTab(data: SideBarRenderData): VirtualElement {
        const title = data.title;
        const key = this.createTabKey(data);
        const style = this.createTabStyle(data);
        const className = this.createTabClass(data);
        const dataset = this.createTabDataset(data);
        return h.li(
            {
                key, className, title: title.caption, style, dataset,
                oncontextmenu: event => this.handleContextMenuEvent(event, title)
            },
            this.renderIcon(data),
            this.renderLabel(data),
            this.renderCloseIcon(data)
        );
    }

    createTabStyle(data: SideBarRenderData): ElementInlineStyle {
        const zIndex = `${data.zIndex}`;
        const labelSize = data.labelSize;
        const iconSize = data.iconSize;
        let height: string | undefined;
        if (labelSize || iconSize) {
            const labelHeight = labelSize ? labelSize.width : 0;
            const iconHeight = iconSize ? iconSize.height : 0;
            let paddingTop = data.paddingTop || 0;
            if (labelHeight > 0 && iconHeight > 0) {
                // Leave some extra space between icon and label
                paddingTop = paddingTop * 1.5;
            }
            const paddingBottom = data.paddingBottom || 0;
            height = `${labelHeight + iconHeight + paddingTop + paddingBottom}px`;
        }
        return { zIndex, height };
    }

    renderLabel(data: SideBarRenderData): VirtualElement {
        const labelSize = data.labelSize;
        const iconSize = data.iconSize;
        let width: string | undefined;
        let height: string | undefined;
        let top: string | undefined;
        if (labelSize) {
            width = `${labelSize.width}px`;
            height = `${labelSize.height}px`;
        }
        if (data.paddingTop || iconSize) {
            const iconHeight = iconSize ? iconSize.height : 0;
            let paddingTop = data.paddingTop || 0;
            if (iconHeight > 0) {
                // Leave some extra space between icon and label
                paddingTop = paddingTop * 1.5;
            }
            top = `${paddingTop + iconHeight}px`;
        }
        const style: ElementInlineStyle = { width, height, top };
        return h.div({ className: 'p-TabBar-tabLabel', style }, data.title.label);
    }

    renderIcon(data: SideBarRenderData): VirtualElement {
        let top: string | undefined;
        if (data.paddingTop) {
            top = `${data.paddingTop || 0}px`;
        }
        const className = this.createIconClass(data);
        const style: ElementInlineStyle = { top };
        return h.div({ className, style }, data.title.iconLabel);
    }

    protected handleContextMenuEvent(event: MouseEvent, title: Title<Widget>) {
        if (this.contextMenuPath) {
            event.stopPropagation();
            event.preventDefault();

            if (this.tabBar !== undefined) {
                this.tabBar.currentTitle = title;
                this.tabBar.activate();
                if (title.owner !== null) {
                    title.owner.activate();
                }
            }

            this.contextMenuRenderer.render(this.contextMenuPath, event);
        }
    }
}

/**
 * A specialized tab bar for side areas.
 */
export class SideTabBar extends TabBar<Widget> {

    static readonly OVERLAY_PAD = 3;
    static readonly DRAG_THRESHOLD = 5;

    readonly tabAdded = new Signal<this, Title<Widget>>(this);
    readonly collapseRequested = new Signal<this, Title<Widget>>(this);

    private mouseData?: {
        pressX: number,
        pressY: number,
        mouseDownTabIndex: number
    };

    constructor(options?: TabBar.IOptions<Widget>) {
        super(options);

        const hiddenContent = document.createElement('ul');
        hiddenContent.className = HIDDEN_CONTENT_CLASS;
        this.node.appendChild(hiddenContent);
    }

    get hiddenContentNode(): HTMLUListElement {
        return this.node.getElementsByClassName(HIDDEN_CONTENT_CLASS)[0] as HTMLUListElement;
    }

    insertTab(index: number, value: Title<Widget> | Title.IOptions<Widget>): Title<Widget> {
        const result = super.insertTab(index, value);
        this.tabAdded.emit(result);
        return result;
    }

    protected onUpdateRequest(msg: Message): void {
        this.renderTabs(this.hiddenContentNode);
        window.requestAnimationFrame(() => {
            const hiddenContent = this.hiddenContentNode;
            const n = hiddenContent.children.length;
            const renderData = new Array<Partial<SideBarRenderData>>(n);
            for (let i = 0; i < n; i++) {
                const hiddenTab = hiddenContent.children[i];
                const tabStyle = window.getComputedStyle(hiddenTab);
                const rd: Partial<SideBarRenderData> = {
                    paddingTop: parseFloat(tabStyle.paddingTop!),
                    paddingBottom: parseFloat(tabStyle.paddingBottom!)
                };
                const labelElements = hiddenTab.getElementsByClassName('p-TabBar-tabLabel');
                if (labelElements.length === 1) {
                    const label = labelElements[0];
                    rd.labelSize = { width: label.clientWidth, height: label.clientHeight };
                }
                const iconElements = hiddenTab.getElementsByClassName('p-TabBar-tabIcon');
                if (iconElements.length === 1) {
                    const icon = iconElements[0];
                    rd.iconSize = { width: icon.clientWidth, height: icon.clientHeight };
                }
                renderData[i] = rd;
            }
            this.renderTabs(this.contentNode, renderData);
        });
    }

    protected renderTabs(host: HTMLElement, renderData?: Partial<SideBarRenderData>[]): void {
        const titles = this.titles;
        const n = titles.length;
        const renderer = this.renderer as TabBarRenderer;
        const currentTitle = this.currentTitle;
        const content = new Array<VirtualElement>(n);
        for (let i = 0; i < n; i++) {
            const title = titles[i];
            const current = title === currentTitle;
            const zIndex = current ? n : n - i - 1;
            let rd: SideBarRenderData;
            if (renderData && i < renderData.length) {
                rd = { title, current, zIndex, ...renderData[i] };
            } else {
                rd = { title, current, zIndex };
            }
            content[i] = renderer.renderTab(rd);
        }
        VirtualDOM.render(content, host);
    }

    protected onBeforeAttach(msg: Message): void {
        super.onBeforeAttach(msg);
        if (this.orientation === 'vertical') {
            this.node.addEventListener('p-dragenter', this);
            this.node.addEventListener('p-dragleave', this);
            this.node.addEventListener('p-dragover', this);
            this.node.addEventListener('p-drop', this);
        }
    }

    protected onAfterDetach(msg: Message): void {
        if (this.orientation === 'vertical') {
            this.node.removeEventListener('p-dragenter', this);
            this.node.removeEventListener('p-dragleave', this);
            this.node.removeEventListener('p-dragover', this);
            this.node.removeEventListener('p-drop', this);
        }
        super.onAfterDetach(msg);
    }

    handleEvent(event: Event): void {
        switch (event.type) {
            case 'mousedown':
                this.onMouseDown(event as MouseEvent);
                super.handleEvent(event);
                break;
            case 'mouseup':
                super.handleEvent(event);
                this.onMouseUp(event as MouseEvent);
                break;
            case 'mousemove':
                this.onMouseMove(event as MouseEvent);
                super.handleEvent(event);
                break;
            default:
                super.handleEvent(event);
        }
    }

    private onMouseDown(event: MouseEvent): void {
        // Check for left mouse button and current mouse status
        if (event.button !== 0 || this.mouseData) {
            return;
        }

        // Check whether the mouse went down on the current tab
        const tabs = this.contentNode.children;
        const index = ArrayExt.findFirstIndex(tabs, tab => ElementExt.hitTest(tab, event.clientX, event.clientY));
        if (index !== this.currentIndex) {
            return;
        }

        // Check whether the close button was clicked
        const icon = tabs[index].querySelector(this.renderer.closeIconSelector);
        if (icon && icon.contains(event.target as HTMLElement)) {
            return;
        }

        this.mouseData = {
            pressX: event.clientX,
            pressY: event.clientY,
            mouseDownTabIndex: index
        };
    }

    private onMouseUp(event: MouseEvent): void {
        // Check for left mouse button and current mouse status
        if (event.button !== 0 || !this.mouseData) {
            return;
        }

        // Check whether the mouse went up on the current tab
        const mouseDownTabIndex = this.mouseData.mouseDownTabIndex;
        this.mouseData = undefined;
        const tabs = this.contentNode.children;
        const index = ArrayExt.findFirstIndex(tabs, tab => ElementExt.hitTest(tab, event.clientX, event.clientY));
        if (index < 0 || index !== mouseDownTabIndex) {
            return;
        }

        // Collapse the side bar
        this.collapseRequested.emit(this.titles[index]);
    }

    private onMouseMove(event: MouseEvent): void {
        // Check for left mouse button and current mouse status
        if (event.button !== 0 || !this.mouseData) {
            return;
        }

        const data = this.mouseData;
        const dx = Math.abs(event.clientX - data.pressX);
        const dy = Math.abs(event.clientY - data.pressY);
        const threshold = SideTabBar.DRAG_THRESHOLD;
        if (dx >= threshold || dy >= threshold) {
            this.mouseData = undefined;
        }
    }

}
