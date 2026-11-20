import { button, el } from './dom';
import type { Screen } from './UIManager';

export interface MainMenuActions {
  canContinue(): boolean;
  storageWarning(): boolean;
  continueGame(): void;
  newGame(): void;
  loadGame(): void;
  settings(): void;
  credits(): void;
  quit?(): void;
}

interface Briefing {
  title: string;
  code: string;
  status: string;
  desc: string;
}

const BRIEFINGS: Record<string, Briefing> = {
  continue: {
    title: 'RESUME INVESTIGATION',
    code: 'SEC-RECOVERY // SLOT-AUTO',
    status: 'STANDBY',
    desc: 'Restore the most recent recorded acoustic telemetry and resume your investigation from the last secured sector checkpoint.',
  },
  newGame: {
    title: 'NEW INVESTIGATION',
    code: 'OP-INITIALIZE // HOLLIN-RIDGE',
    status: 'AUTHORIZED',
    desc: 'Infiltrate the lower Acoustic Science Annex. Containment protocols have failed. Maintain absolute silence to evade the Hush.',
  },
  loadGame: {
    title: 'ACCESS ARCHIVES',
    code: 'ARC-STORAGE // TAPE-BANK',
    status: 'ONLINE',
    desc: 'Review and load previously recorded magnetic tape logs and checkpoint states across all laboratory bays.',
  },
  settings: {
    title: 'SYSTEM CONFIGURATION',
    code: 'SYS-CALIBRATE // HARDWARE',
    status: 'DIAGNOSTIC',
    desc: 'Calibrate spatial acoustic channels, master volume levels, visual rendering performance, and input sensitivities.',
  },
  credits: {
    title: 'PERSONNEL DOSSIER',
    code: 'DOS-PERSONNEL // RECORD-87',
    status: 'CLASSIFIED',
    desc: 'Access attribution records for the procedural audio synthesis, physics engine, and development personnel behind THE LAST DOOR.',
  },
  quit: {
    title: 'TERMINATE SESSION',
    code: 'SYS-DISENGAGE // SECURE',
    status: 'READY',
    desc: 'Safely disconnect from the Hollin Ridge terminal session and return control to the host operating system.',
  },
};

function signalLine(): SVGSVGElement {
  // A hand-drawn-looking trace of the carrier wave. It settles to flat in the centre.
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'signal-line');
  svg.setAttribute('viewBox', '0 0 360 24');
  svg.setAttribute('preserveAspectRatio', 'none');
  let d = 'M0 12';
  for (let x = 2; x <= 360; x += 2) {
    const envelope = Math.abs(x - 170) / 170;
    const y = 12 + Math.sin(x * 0.34) * Math.sin(x * 0.043) * 9 * envelope * envelope;
    d += ` L${x} ${y.toFixed(1)}`;
  }
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

export class MainMenu implements Screen {
  readonly root: HTMLElement;
  readonly dismissible = false;
  private continueButton: HTMLButtonElement;
  private newGameButton: HTMLButtonElement;
  private loadButton: HTMLButtonElement;
  private settingsButton: HTMLButtonElement;
  private creditsButton: HTMLButtonElement;
  private quitButton?: HTMLButtonElement;
  private hint: HTMLElement;

  private briefingTitle: HTMLElement;
  private briefingCode: HTMLElement;
  private briefingStatus: HTMLElement;
  private briefingDesc: HTMLElement;

  constructor(private actions: MainMenuActions) {
    this.root = el('div', 'screen menu-screen');

    // ── Top Bar ──
    const topBar = el('div', 'menu-top-bar', [
      el('div', 'menu-top-left', [
        el('span', 'facility-tag', 'RESTRICTED AREA // SECTOR 04'),
        el('span', 'facility-name', 'HOLLIN RIDGE RESEARCH STATION'),
      ]),
      el('div', 'menu-top-right', [
        el('span', 'carrier-freq', '432.8 Hz CARRIER'),
        el('span', 'status-beacon', [el('i', 'beacon-dot'), 'MONITORING']),
      ]),
    ]);

    // ── Brand ──
    const mark = el('div', 'menu-mark', [el('i'), el('i'), el('i')], { 'aria-hidden': 'true' });
    const title = el('h1', 'game-title', [
      el('small', '', 'Hollin Ridge Institute of Acoustic Science'),
      'THE LAST DOOR',
    ]);
    const brand = el('div', 'menu-brand', [
      mark,
      el('div', 'menu-title-lockup', [
        title,
        el('div', 'menu-date', 'INCIDENT DOSSIER // 09 DECEMBER 1987 // CLEARANCE LEVEL 4'),
      ]),
    ]);

    // ── Navigation Buttons ──
    this.continueButton = button('menu-item menu-item-continue', 'Continue', () => actions.continueGame());
    this.continueButton.setAttribute('data-key', 'continue');
    this.continueButton.setAttribute('data-index', '01');

    this.newGameButton = button('menu-item menu-item-new-game', 'New Game', () => actions.newGame());
    this.newGameButton.setAttribute('data-key', 'newGame');
    this.newGameButton.setAttribute('data-index', '02');

    this.loadButton = button('menu-item menu-item-load-game', 'Load Game', () => actions.loadGame());
    this.loadButton.setAttribute('data-key', 'loadGame');
    this.loadButton.setAttribute('data-index', '03');

    this.settingsButton = button('menu-item menu-item-settings', 'Settings', () => actions.settings());
    this.settingsButton.setAttribute('data-key', 'settings');
    this.settingsButton.setAttribute('data-index', '04');

    this.creditsButton = button('menu-item menu-item-credits', 'Credits', () => actions.credits());
    this.creditsButton.setAttribute('data-key', 'credits');
    this.creditsButton.setAttribute('data-index', '05');

    const buttons = [
      this.continueButton,
      this.newGameButton,
      this.loadButton,
      this.settingsButton,
      this.creditsButton,
    ];

    if (actions.quit) {
      this.quitButton = button('menu-item menu-item-quit', 'Quit', () => actions.quit!());
      this.quitButton.setAttribute('data-key', 'quit');
      this.quitButton.setAttribute('data-index', '06');
      buttons.push(this.quitButton);
    }

    this.hint = el('div', 'menu-hint');
    const list = el('nav', 'menu-list', [...buttons]);

    // ── Briefing Card ──
    this.briefingStatus = el('span', 'briefing-status', 'AUTHORIZED');
    this.briefingCode = el('div', 'briefing-code', 'OP-INITIALIZE // HOLLIN-RIDGE');
    this.briefingTitle = el('h3', 'briefing-title', 'NEW INVESTIGATION');
    this.briefingDesc = el('p', 'briefing-desc', BRIEFINGS.newGame.desc);

    const briefingCard = el('div', 'menu-briefing-card', [
      el('div', 'briefing-card-header', [
        el('span', 'briefing-tag', 'TERMINAL DOSSIER'),
        this.briefingStatus,
      ]),
      this.briefingCode,
      this.briefingTitle,
      el('div', 'briefing-rule'),
      this.briefingDesc,
      el('div', 'briefing-warning', [
        el('span', 'warning-icon', '⚠'),
        el('span', 'warning-text', 'ACOUSTIC PROTOCOL: SENSORS HIGHLY SENSITIVE. MAINTAIN SILENCE.'),
      ]),
    ]);

    // Attach hover/focus listeners to buttons to update briefing
    for (const btn of buttons) {
      const key = btn.getAttribute('data-key') || '';
      const updateBriefing = () => {
        const info = BRIEFINGS[key];
        if (!info) return;
        this.briefingTitle.textContent = info.title;
        this.briefingCode.textContent = info.code;
        this.briefingStatus.textContent = btn.disabled ? 'LOCKED' : info.status;
        this.briefingStatus.classList.toggle('locked', btn.disabled);
        this.briefingDesc.textContent = info.desc;
      };
      btn.addEventListener('mouseenter', updateBriefing);
      btn.addEventListener('focus', updateBriefing);
    }

    // ── Layout Columns ──
    const mainColumn = el('div', 'menu-main-column', [
      brand,
      signalLine(),
      list,
      this.hint,
    ]);

    const briefingColumn = el('div', 'menu-briefing-column', [briefingCard]);
    const layout = el('div', 'menu-layout', [mainColumn, briefingColumn]);

    // ── Footer ──
    const footer = el('div', 'menu-footer', [
      el('span', 'footer-left', 'Hollin Ridge Acoustic Institute  /  1987'),
      el('span', 'footer-center', 'Headphones recommended for 3D binaural isolation'),
      el('span', 'footer-right', '[↑ / ↓] Navigate   [Enter] Confirm'),
    ]);

    this.root.append(
      el('div', 'menu-atmosphere'),
      topBar,
      layout,
      footer,
    );
  }

  onOpen(): void {
    this.refresh();
  }

  refresh(): void {
    const canContinue = this.actions.canContinue();
    this.continueButton.disabled = !canContinue;
    this.loadButton.disabled = !canContinue;
    this.hint.textContent = this.actions.storageWarning()
      ? 'Browser storage is unavailable, so progress will not be kept after closing this page.'
      : '';

    // Set initial briefing state
    if (canContinue) {
      const info = BRIEFINGS.continue;
      this.briefingTitle.textContent = info.title;
      this.briefingCode.textContent = info.code;
      this.briefingStatus.textContent = info.status;
      this.briefingStatus.classList.remove('locked');
      this.briefingDesc.textContent = info.desc;
    } else {
      const info = BRIEFINGS.newGame;
      this.briefingTitle.textContent = info.title;
      this.briefingCode.textContent = info.code;
      this.briefingStatus.textContent = info.status;
      this.briefingStatus.classList.remove('locked');
      this.briefingDesc.textContent = info.desc;
    }
  }
}

export class CreditsScreen implements Screen {
  readonly root: HTMLElement;

  constructor(onBack: () => void) {
    this.root = el('div', 'screen overlay-screen');
    const panel = el('div', 'panel');
    panel.style.width = 'min(620px, 100%)';
    panel.append(
      el('div', 'panel-header', [el('h2', 'panel-title', 'Credits')]),
      el('div', 'panel-body', [
        el('p', 'inv-description', 'THE LAST DOOR is an original work. Every texture, model, sound and line of music is generated by the game itself as it loads. No image or audio files are used.'),
        el('div', 'label', 'Built with'),
        el('p', 'inv-description', 'Three.js, Rapier, TypeScript and Vite, with no game engine.'),
        el('div', 'label', 'Typefaces (SIL Open Font License)'),
        el('p', 'inv-description', 'Cormorant Garamond, Barlow Condensed, Courier Prime, VT323.'),
      ]),
      el('div', 'panel-footer', [el('span', 'key-hint'), button('text-button', 'Back', onBack)]),
    );
    this.root.append(panel);
  }
}
