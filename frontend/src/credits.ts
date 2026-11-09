import { LitElement, TemplateResult, css, html, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { HassEntity } from './types';

export const SNOWSURE_URL = 'https://www.snowsure.ai';

/**
 * SnowSure's terms name this credit word for word, so it stays English in
 * every language.
 */
export const ATTRIBUTION = 'Data by SnowSure.ai';

/** One upstream source SnowSure lists under `credits.upstream` (parser.py). */
export interface UpstreamCredit {
  name: string;
  text: string;
  url?: string | null;
  license?: string | null;
}

/**
 * The upstream sources the integration puts on each resort's `updated_at`
 * sensor, merged across resorts without duplicates. SnowSure's API asks every
 * display of its data to carry them next to its own credit.
 */
export function upstreamCredits(entities: (HassEntity | undefined)[]): UpstreamCredit[] {
  const seen = new Map<string, UpstreamCredit>();
  for (const entity of entities) {
    const sources = entity?.attributes.sources;
    if (!Array.isArray(sources)) continue;
    for (const source of sources as Partial<UpstreamCredit>[]) {
      if (!source || typeof source.text !== 'string' || !source.text) continue;
      const key = source.name || source.text;
      if (!seen.has(key)) seen.set(key, source as UpstreamCredit);
    }
  }
  return [...seen.values()];
}

/**
 * The ⓘ in the footer corner. Its popover lists the upstream sources over the
 * card instead of growing it: on hover with a mouse, on a tap on touch
 * screens. A tap outside or Escape closes it again.
 */
export class SnowsureCredits extends LitElement {
  @property({ attribute: false }) public credits: UpstreamCredit[] = [];
  @property() public label = 'Sources';
  @state() private _open = false;

  static styles = css`
    :host {
      position: relative;
      display: inline-flex;
      align-items: center;
    }

    button {
      display: inline-flex;
      padding: 0;
      border: none;
      background: none;
      color: var(--secondary-text-color);
      cursor: pointer;
      --mdc-icon-size: 16px;
    }

    button:hover,
    button[aria-expanded='true'] {
      color: var(--primary-color);
    }

    .popover {
      display: none;
      position: absolute;
      right: -4px;
      bottom: calc(100% + 8px);
      z-index: 10;
      box-sizing: border-box;
      width: max-content;
      /* Never wider than the card: both cards are size containers. */
      max-width: min(340px, calc(100cqw - 16px));
      padding: 8px 12px;
      border: 1px solid var(--divider-color);
      border-radius: 8px;
      background: var(--card-background-color, var(--ha-card-background, #fff));
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
      color: var(--primary-text-color);
      font-size: 0.7rem;
      line-height: 1.4;
      text-align: left;
      white-space: normal;
    }

    /* Bridges the gap to the icon, so the mouse can reach the links. */
    .popover::after {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      top: 100%;
      height: 8px;
    }

    .popover.open {
      display: block;
    }

    /* Only real hover: on touch screens a tap would otherwise stick it open. */
    @media (hover: hover) {
      :host(:hover) .popover {
        display: block;
      }
    }

    .title {
      margin-bottom: 4px;
      font-weight: 500;
    }

    ul {
      display: flex;
      flex-direction: column;
      gap: 3px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    a {
      color: var(--primary-color);
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    .license {
      color: var(--secondary-text-color);
    }
  `;

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._setOpen(false);
  }

  private _onOutside = (ev: Event): void => {
    if (!ev.composedPath().includes(this)) this._setOpen(false);
  };

  private _onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') this._setOpen(false);
  };

  private _setOpen(open: boolean): void {
    this._open = open;
    const method = open ? 'addEventListener' : 'removeEventListener';
    window[method]('click', this._onOutside as EventListener, true);
    window[method]('keydown', this._onKey as EventListener);
  }

  protected render(): TemplateResult | typeof nothing {
    if (!this.credits.length) return nothing;
    return html`<button
        aria-label=${this.label}
        aria-expanded=${this._open ? 'true' : 'false'}
        aria-controls="sources"
        @click=${() => this._setOpen(!this._open)}
      >
        <ha-icon icon="mdi:information-outline"></ha-icon>
      </button>
      <div id="sources" class="popover ${this._open ? 'open' : ''}">
        <div class="title">${this.label}</div>
        <ul>
          ${this.credits.map(
            (credit) =>
              html`<li>
                ${
                  credit.url?.startsWith('https://')
                    ? html`<a href=${credit.url} target="_blank" rel="noopener noreferrer">${credit.text}</a>`
                    : credit.text
                }${credit.license ? html` <span class="license">· ${credit.license}</span>` : nothing}
              </li>`,
          )}
        </ul>
      </div>`;
  }
}

if (!customElements.get('snowsure-credits')) {
  customElements.define('snowsure-credits', SnowsureCredits);
}
