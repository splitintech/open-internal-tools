// Outreach Console — Papr mini-app. All data flows through this app's backend handler (backend/outreach.mjs),
// which holds the API token server-side. Every value from the engine is untrusted: rendered with textContent only.
(() => {
  const APP_ID = new URLSearchParams(location.search).get('appId') || document.documentElement.dataset.appId || 'outreach-console';
  const $ = (id) => document.getElementById(id);

  async function call(action, params = {}) {
    const res = await fetch(`/api/app/backend/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: APP_ID, params }),
    });
    const envelope = await res.json().catch(() => ({}));
    let result;
    try {
      result = JSON.parse(envelope.stdout || '{}');
    } catch {
      result = { ok: false, error: 'the backend returned no result' };
    }
    if (!result.ok) throw new Error(result.error || 'request failed');
    return result.data;
  }

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') node.className = value;
      else if (key === 'onclick') node.addEventListener('click', value);
      else if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value);
    }
    for (const child of children.flat()) if (child) node.append(child);
    return node;
  }

  function toast(message) {
    const node = $('toast');
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 2600);
  }

  function empty(listId, message) {
    const list = $(listId);
    list.replaceChildren(el('li', { class: 'empty', text: message }));
  }

  /** Runs an action, disables the button meanwhile, reports the outcome, then refreshes. */
  async function act(button, action, params, done) {
    button.disabled = true;
    try {
      await call(action, params);
      toast(done);
      await refresh();
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  }

  const HOLDS = {
    approval: ['hold', 'needs approval'],
    outside_send_window: ['hold', 'outside send window'],
    campaign_paused: ['stop', 'campaign paused'],
    enrollment_paused: ['stop', 'contact paused'],
    recipient_min_gap: ['hold', 'spacing out touches'],
  };

  function chipFor(action) {
    const reason = action.waitingOn || '';
    if (action.state === 'executing' || action.state === 'claimed') return el('span', { class: 'chip ready', text: 'sending now' });
    if (!reason) return el('span', { class: 'chip ready', text: 'ready' });
    if (reason.startsWith('kill_switch')) return el('span', { class: 'chip stop', text: 'kill switch' });
    if (reason.startsWith('rate_limit')) return el('span', { class: 'chip hold', text: 'daily limit' });
    if (reason.startsWith('account_')) return el('span', { class: 'chip stop', text: 'account needs attention' });
    const [tone, label] = HOLDS[reason] || ['hold', reason.replace(/_/g, ' ')];
    return el('span', { class: `chip ${tone}`, text: label });
  }

  function renderTimeline(actions) {
    if (!actions.length) return empty('timeline', 'Nothing is scheduled to go out in the next 24 hours.');
    const fmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
    $('timeline').replaceChildren(
      ...actions.map((a) =>
        el(
          'li',
          { class: 'slot' },
          el('time', { datetime: new Date(a.dueAt).toISOString(), text: a.dueAt <= Date.now() ? 'now' : fmt.format(a.dueAt) }),
          el('div', {}, el('div', { class: 'who', text: a.recipient || a.kind }, chipFor(a)), el('div', { class: 'what', text: `${a.subject || a.kind} · ${a.campaignName || 'no campaign'}` })),
          a.campaignId
            ? el('button', { type: 'button', class: 'ghost', onclick: (e) => act(e.currentTarget, 'campaign-pause', { campaignId: a.campaignId, reason: 'paused from Outreach Console' }, 'Campaign paused'), text: 'Pause campaign' })
            : null,
        ),
      ),
    );
  }

  function renderApprovals(approvals) {
    if (!approvals.length) return empty('approvals', 'No approvals waiting.');
    $('approvals').replaceChildren(
      ...approvals.map((a) => {
        const items = (a.preview && a.preview.actions) || [];
        const summary = a.scope === 'campaign_version'
          ? `Activate "${a.preview.campaign}" for ${a.preview.audienceCount} people`
          : `${items.length} message${items.length === 1 ? '' : 's'}`;
        return el(
          'li',
          { class: 'card' },
          el('strong', { text: summary }),
          items.length ? el('pre', { text: items.slice(0, 5).map((i) => `${i.recipient} — ${i.subject || ''}`).join('\n') + (items.length > 5 ? `\n… and ${items.length - 5} more` : '') }) : null,
          el('div', { class: 'meta', text: `hash ${a.operation_hash.slice(0, 12)}… · expires ${new Date(a.expires_at).toLocaleString()}` }),
          el(
            'div',
            { class: 'row' },
            el('button', { type: 'button', class: 'primary', text: 'Approve exactly this', onclick: (e) => act(e.currentTarget, 'approval-decide', { approvalId: a.id, decision: 'approved', operationHash: a.operation_hash }, 'Approved') }),
            el('button', { type: 'button', text: 'Reject', onclick: (e) => act(e.currentTarget, 'approval-decide', { approvalId: a.id, decision: 'rejected', operationHash: a.operation_hash, reason: 'rejected in Outreach Console' }, 'Rejected') }),
          ),
        );
      }),
    );
  }

  function renderReview(actions) {
    if (!actions.length) return empty('review', 'Nothing needs a human right now.');
    $('review').replaceChildren(
      ...actions.map((a) =>
        el(
          'li',
          { class: 'card' },
          el('strong', { text: a.recipient_norm || a.kind }),
          el('div', { class: 'meta', text: `${(a.state_reason || '').replace(/_/g, ' ')} · ${a.attempt_count} attempt(s)` }),
          el(
            'div',
            { class: 'row' },
            el('button', { type: 'button', text: 'It went out', onclick: (e) => {
              const id = prompt('Provider message id from your sent folder (required to record it as sent):');
              if (id) act(e.currentTarget, 'review-resolve', { actionId: a.id, kind: 'sent', providerMessageId: id }, 'Recorded as sent');
            } }),
            el('button', { type: 'button', text: 'Not sent — send it', onclick: (e) => act(e.currentTarget, 'review-resolve', { actionId: a.id, kind: 'not_sent_retry' }, 'Rescheduled') }),
            el('button', { type: 'button', class: 'ghost', text: 'Drop', onclick: (e) => act(e.currentTarget, 'review-resolve', { actionId: a.id, kind: 'drop', reason: 'dropped in Outreach Console' }, 'Dropped') }),
          ),
        ),
      ),
    );
  }

  function renderTasks(tasks) {
    if (!tasks.length) return empty('tasks', 'No manual touches waiting.');
    $('tasks').replaceChildren(
      ...tasks.map((t) =>
        el(
          'li',
          { class: 'card' },
          el('strong', { text: `${t.channel} touch` }),
          el('pre', { text: t.draft_text }),
          el(
            'div',
            { class: 'row' },
            t.target_url && /^https:\/\//.test(t.target_url) ? el('a', { href: t.target_url, target: '_blank', rel: 'noopener noreferrer', text: 'Open profile' }) : null,
            el('button', { type: 'button', text: 'Copy draft', onclick: () => navigator.clipboard.writeText(t.draft_text).then(() => toast('Draft copied')) }),
            el('button', { type: 'button', class: 'primary', text: 'I did it', onclick: (e) => act(e.currentTarget, 'task-outcome', { taskId: t.id, outcome: 'done' }, 'Recorded') }),
            el('button', { type: 'button', class: 'ghost', text: 'Skip', onclick: (e) => act(e.currentTarget, 'task-outcome', { taskId: t.id, outcome: 'skipped' }, 'Skipped') }),
          ),
        ),
      ),
    );
  }

  const COLORS = { active: 'var(--accent)', completed: 'var(--ok)', replied: 'var(--ok)', paused: 'var(--hold)', opted_out: 'var(--muted)', bounced: 'var(--stop)', stopped: 'var(--muted)', error: 'var(--stop)' };

  function renderCampaigns(campaigns, statuses) {
    if (!campaigns.length) return empty('campaigns', 'No campaigns yet. Create one with `outreach campaign create`.');
    const byId = new Map(statuses.map((s) => [s.campaignId, s]));
    $('campaigns').replaceChildren(
      ...campaigns.map((c) => {
        const counts = (byId.get(c.id) || {}).enrollments || {};
        const total = Object.values(counts).reduce((sum, n) => sum + n, 0) || 1;
        return el(
          'li',
          { class: 'campaign' },
          el('strong', { text: c.name }),
          el('div', { class: 'meta', text: `${c.status} · ${Object.entries(counts).map(([k, n]) => `${n} ${k.replace('_', ' ')}`).join(' · ') || 'no enrollments'}` }),
          el('div', { class: 'bars' }, ...Object.entries(counts).map(([k, n]) => el('span', { style: `width:${(n / total) * 100}%;background:${COLORS[k] || 'var(--muted)'}` }))),
          c.status === 'paused'
            ? el('button', { type: 'button', text: 'Resume', onclick: (e) => act(e.currentTarget, 'campaign-resume', { campaignId: c.id, reason: 'resumed from Outreach Console' }, 'Resumed') })
            : null,
        );
      }),
    );
  }

  async function refresh() {
    try {
      const data = await call('overview');
      renderTimeline(data.upcoming);
      renderApprovals(data.approvals);
      renderReview(data.review);
      renderTasks(data.tasks);
      renderCampaigns(data.campaigns, data.statuses);
      const waiting = data.approvals.length + data.review.length + data.tasks.length;
      $('summary').textContent = `${data.upcoming.length} going out in 24h · ${waiting} waiting on you`;
    } catch (error) {
      $('summary').textContent = `Cannot reach the outreach engine: ${error.message}. Is \`outreach serve\` running, and are OUTREACH_API_URL / OUTREACH_API_TOKEN set?`;
    }
  }

  $('refresh').addEventListener('click', refresh);
  $('stop-all').addEventListener('click', (e) => {
    if (confirm('Stop every send in this workspace now? Resuming needs an approver.')) {
      act(e.currentTarget, 'kill-switch', { scope: 'workspace', engaged: 'true', reason: 'stopped from Outreach Console' }, 'All sending stopped');
    }
  });
  refresh();
  setInterval(refresh, 30_000);
})();
