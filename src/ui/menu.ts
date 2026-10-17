export interface MenuHandlers {
  onNewWorld(seedText: string): void;
  onContinue(): void;
  onReset(): void;
}

export interface GameMenu {
  show(): void;
  hide(): void;
  /** `persistent` is false when the browser will not keep localStorage. */
  setSave(save: { seed: number } | null, persistent?: boolean): void;
}

const STYLE_ID = 'iso-menu-style';

/**
 * Title screen. New world reads the seed field, Continue loads the save,
 * and Reset deletes it. The game loop stays stopped while this is open.
 */
export function mountMenu(parent: HTMLElement, handlers: MenuHandlers): GameMenu {
  ensureStyle();

  const root = document.createElement('div');
  root.className = 'iso-menu';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'iso-menu-title');
  root.setAttribute('aria-hidden', 'true');

  const card = document.createElement('form');
  card.className = 'iso-card';
  card.noValidate = true;

  const title = document.createElement('h1');
  title.id = 'iso-menu-title';
  title.textContent = 'isovoxel';

  const blurb = document.createElement('p');
  blurb.textContent = 'Isometric voxel sandbox. The world is kept in this browser.';

  const label = document.createElement('label');
  label.textContent = 'World seed';
  const seedInput = document.createElement('input');
  seedInput.type = 'text';
  seedInput.name = 'seed';
  seedInput.spellcheck = false;
  seedInput.autocomplete = 'off';
  seedInput.placeholder = 'Blank for a random seed';
  seedInput.setAttribute('aria-label', 'World seed');
  label.appendChild(seedInput);

  const newButton = document.createElement('button');
  newButton.type = 'submit';
  newButton.className = 'primary';
  newButton.textContent = 'New world';

  const continueButton = document.createElement('button');
  continueButton.type = 'button';
  continueButton.textContent = 'Continue';

  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'reset';
  resetButton.textContent = 'Reset save';

  const status = document.createElement('p');
  status.className = 'iso-note';

  card.append(title, blurb, label, newButton, continueButton, resetButton, status);
  root.appendChild(card);
  parent.appendChild(root);

  card.addEventListener('submit', (event) => {
    event.preventDefault();
    if (root.hidden) return;
    handlers.onNewWorld(seedInput.value);
  });
  continueButton.addEventListener('click', () => {
    if (root.hidden) return;
    handlers.onContinue();
  });
  resetButton.addEventListener('click', () => {
    if (root.hidden) return;
    handlers.onReset();
  });

  const menu: GameMenu = {
    show() {
      root.hidden = false;
      root.setAttribute('aria-hidden', 'false');
      seedInput.focus();
    },
    hide() {
      root.hidden = true;
      root.setAttribute('aria-hidden', 'true');
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    },
    setSave(save, persistent = true) {
      const has = save !== null;
      continueButton.disabled = !has;
      resetButton.disabled = !has;
      if (!persistent) {
        status.textContent = has
          ? `Seed ${save.seed} is remembered until this tab closes. This browser is not keeping localStorage.`
          : 'This browser is not keeping localStorage. A new world lasts until the tab closes.';
        return;
      }
      status.textContent = has ? `Saved world, seed ${save.seed}.` : 'No saved world in this browser.';
    },
  };
  menu.setSave(null);
  return menu;
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .iso-menu {
      position: fixed;
      inset: 0;
      z-index: 5;
      display: grid;
      place-items: center;
      padding: 16px;
      background: rgba(8, 24, 32, 0.48);
      color: #f4fbff;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .iso-menu[hidden] {
      display: none !important;
    }
    .iso-card {
      width: min(420px, 100%);
      margin: 0;
      padding: 28px 28px 22px;
      background: rgba(12, 28, 36, 0.94);
      border: 1px solid rgba(244, 251, 255, 0.18);
      box-shadow: 0 18px 50px rgba(0, 0, 0, 0.28);
      box-sizing: border-box;
    }
    .iso-card h1 {
      margin: 0 0 8px;
      font-size: 28px;
      font-weight: 600;
      letter-spacing: 0.04em;
    }
    .iso-card p {
      margin: 0 0 18px;
      color: #d5eaf3;
      font-size: 13px;
      line-height: 1.45;
    }
    .iso-card label {
      display: block;
      margin-bottom: 8px;
      color: #d5eaf3;
      font-size: 12px;
    }
    .iso-card input {
      display: block;
      width: 100%;
      box-sizing: border-box;
      margin-top: 6px;
      padding: 8px 10px;
      font: inherit;
      color: #12303a;
      background: #f4fbff;
      border: 1px solid transparent;
    }
    .iso-card button {
      display: block;
      width: 100%;
      margin: 8px 0 0;
      padding: 10px 12px;
      font: inherit;
      color: #1c2c34;
      background: rgba(232, 242, 246, 0.92);
      border: 1px solid rgba(20, 36, 44, 0.35);
      cursor: pointer;
    }
    .iso-card button.primary {
      background: #f0b429;
      border-color: #c48a12;
    }
    .iso-card button.reset {
      color: #f4fbff;
      background: transparent;
      border-color: rgba(244, 251, 255, 0.28);
    }
    .iso-card button:disabled {
      opacity: 0.45;
      cursor: default;
    }
    .iso-card button:focus-visible,
    .iso-card input:focus-visible {
      outline: 2px solid #f0b429;
      outline-offset: 2px;
    }
    .iso-card .iso-note {
      margin: 14px 0 0;
      font-size: 12px;
    }
  `;
  document.head.appendChild(style);
}
