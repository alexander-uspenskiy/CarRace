// Pure flow state machine (no DOM). See ARCHITECTURE.md §7.1.

export const STATES = ['title', 'team', 'track', 'settings', 'garage', 'loading', 'race', 'paused', 'results', 'hof'];

export const TRANSITIONS = {
  title: ['team', 'garage', 'hof'],
  team: ['track', 'title'],
  track: ['settings', 'team'],
  settings: ['garage', 'track'],
  garage: ['loading', 'settings', 'title'],
  loading: ['race'],
  race: ['paused', 'results'],
  paused: ['race', 'loading', 'title'],
  results: ['hof', 'settings', 'title'],
  hof: ['title', 'results'],
};

const HISTORY_CAP = 64;

export function createFlowMachine({ initial = 'title', params: initialParams = {} } = {}) {
  if (!STATES.includes(initial)) throw new Error(`flowMachine: unknown initial state "${initial}"`);
  let state = initial;
  let params = initialParams;
  const history = []; // [{state, params}] entries we can go back to
  const listeners = new Set();

  function canTransition(to) {
    return (TRANSITIONS[state] || []).includes(to);
  }

  function apply(to, p, pushHistory) {
    const from = state;
    if (pushHistory) {
      history.push({ state: from, params });
      if (history.length > HISTORY_CAP) history.shift();
    }
    state = to;
    params = p ?? {};
    if (to === 'title') history.length = 0;
    for (const fn of [...listeners]) {
      try {
        fn(from, to, params);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[flow] listener error', e);
      }
    }
    return true;
  }

  return {
    get state() { return state; },
    get params() { return params; },
    get history() { return history.slice(); },
    canTransition,
    transition(to, p) {
      if (!canTransition(to)) return false;
      return apply(to, p, true);
    },
    // Bypasses the table; used ONLY by debug hooks and fatal-error recovery.
    force(to, p) {
      if (!STATES.includes(to)) throw new Error(`flowMachine: unknown state "${to}"`);
      return apply(to, p, true);
    },
    // Return to previous state WITH its previous params. False if no history.
    back() {
      const prev = history.pop();
      if (!prev) return false;
      return apply(prev.state, prev.params, false);
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
