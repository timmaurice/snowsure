/** Dispatches a composed, bubbling custom event (config-changed, hass-more-info, ...). */
export const fireEvent = <T>(node: HTMLElement | Window, type: string, detail?: T): void => {
  node.dispatchEvent(new CustomEvent(type, { bubbles: true, cancelable: false, composed: true, detail }));
};
