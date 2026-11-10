import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, Mail, MessageCircle, Power, Radio, ShieldAlert, Workflow } from "lucide-react";
import { Banner, Button, DataTable, EmptyState, Field, Modal, NoAccess, PageHeader, Panel, Stat, StatusBadge, Tabs } from "../components/ui";
import {
  TEMPLATE_VARIABLE_HELP,
  TRIGGER_LABELS,
  emailEndpointReady,
  markersToPreviewHtml,
  normalizeAutomationConfig,
  renderAutomationTemplate,
  sampleAutomationVars,
  wahaReady,
  wrapSelection,
} from "../domain/automation";
import { formatDateTime, fullName } from "../lib/format";
import { useTab } from "../lib/useTab";
import { useApp } from "../store/store";
import type { AutomationEndpoint, AutomationRule, AutomationTrigger, WahaConfig } from "../types/automation";

type TabId = "overview" | "rules" | "channels" | "logs" | "guide";

const TRIGGERS = Object.keys(TRIGGER_LABELS) as AutomationTrigger[];

export function Automation() {
  const { can } = useApp();
  if (!can("automation.manage")) {
    return <NoAccess body="WhatsApp and email automation is limited to HR and system administrators." />;
  }
  const tabs: { id: TabId; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "rules", label: "Rules" },
    { id: "channels", label: "Channels" },
    { id: "logs", label: "Logs" },
    { id: "guide", label: "Guide" },
  ];
  const [tab, setTab] = useTab(tabs.map((item) => item.id), "overview");
  return (
    <div className="automation-module">
      <PageHeader
        title="Automation"
        subtitle="Rule-driven WhatsApp (WAHA) and email (n8n webhook) for leave, tickets, expenses, payroll, and more."
      />
      <Tabs tabs={tabs} value={tab} onChange={(id) => setTab(id as TabId)} />
      {tab === "overview" && <Overview onOpenChannels={() => setTab("channels")} onOpenRules={() => setTab("rules")} />}
      {tab === "rules" && <Rules />}
      {tab === "channels" && <Channels />}
      {tab === "logs" && <Logs />}
      {tab === "guide" && <Guide />}
    </div>
  );
}

function useConfig() {
  const { state } = useApp();
  return normalizeAutomationConfig(state.automation);
}

function Overview({ onOpenChannels, onOpenRules }: { onOpenChannels: () => void; onOpenRules: () => void }) {
  const config = useConfig();
  const activeRules = config.rules.filter((item) => item.isActive).length;
  const failed = config.logs.filter((item) => item.status === "failed").length;
  const success = config.logs.filter((item) => item.status === "success").length;
  const next =
    !config.settings.automationsEnabled
      ? "Turn on the global switch after WAHA or n8n is healthy."
      : !wahaReady(config.waha) && !emailEndpointReady(config)
        ? "Configure at least one channel under Channels."
        : activeRules === 0
          ? "Activate rules that match your HR events."
          : "Automations are armed. Review logs after the next event.";

  return (
    <div className="stack-lg">
      <div className="stats">
        <Stat
          label="Global switch"
          value={config.settings.automationsEnabled ? "On" : "Off"}
          hint="Kill switch for rule-driven sends"
          icon={<Power size={18} />}
          tone={config.settings.automationsEnabled ? "green" : "amber"}
          to="/automation?tab=channels"
        />
        <Stat
          label="WhatsApp"
          value={wahaReady(config.waha) ? "Ready" : "Not ready"}
          hint={config.waha.lastHealthCheck?.message ?? "WAHA session + API key"}
          icon={<MessageCircle size={18} />}
          tone={wahaReady(config.waha) ? "green" : "amber"}
          to="/automation?tab=channels"
        />
        <Stat
          label="Email"
          value={emailEndpointReady(config) ? "Ready" : "Not ready"}
          hint="n8n webhook delivery (not in-app SMTP)"
          icon={<Mail size={18} />}
          tone={emailEndpointReady(config) ? "teal" : "amber"}
          to="/automation?tab=channels"
        />
        <Stat
          label="Active rules"
          value={String(activeRules)}
          hint={`${config.rules.length} total · ${failed} failed logs`}
          icon={<Workflow size={18} />}
          tone="blue"
          to="/automation?tab=rules"
        />
      </div>

      <Panel title="Next step" action={<Button variant="secondary" onClick={onOpenChannels}>Open channels</Button>}>
        <p>{next}</p>
        <Banner tone="info">
          Email automation posts JSON to n8n. SMTP lives in n8n, not in Buildesk People. WhatsApp sends go through WAHA with a short pause between messages.
        </Banner>
        <div className="actions">
          <Button onClick={onOpenRules}>Manage rules</Button>
          <Button variant="secondary" onClick={onOpenChannels}>Configure channels</Button>
        </div>
      </Panel>

      <Panel title="Recent delivery" action={<Link to="/automation?tab=logs">View logs</Link>}>
        {config.logs.length === 0 ? (
          <EmptyState title="No automation attempts yet" body="Successful and failed handoffs appear here after events or a manual test." />
        ) : (
          <ul className="automation-feed">
            {config.logs.slice(0, 6).map((log) => (
              <li key={log.id} className="notice split">
                <span>
                  <strong>{TRIGGER_LABELS[log.trigger]}</strong>
                  <span className="muted" style={{ display: "block" }}>{formatDateTime(log.attemptedAt)} · {log.channel}</span>
                </span>
                <StatusBadge value={log.status} />
              </li>
            ))}
          </ul>
        )}
        <p className="muted">{success} succeeded · {failed} failed in the retained log window (max 500).</p>
      </Panel>
    </div>
  );
}

function Channels() {
  const { user, actions } = useApp();
  const config = useConfig();
  const [settings, setSettings] = useState(config.settings);
  const [waha, setWaha] = useState<WahaConfig>(config.waha);
  const [endpoints, setEndpoints] = useState<AutomationEndpoint[]>(config.endpoints);
  const [error, setError] = useState("");
  const [testOpen, setTestOpen] = useState<"whatsapp" | "email" | null>(null);
  const [testMessage, setTestMessage] = useState("Buildesk People automation test.");
  const [testTarget, setTestTarget] = useState("");

  return (
    <div className="stack-lg">
      <Panel title="Global controls">
        <label className="check">
          <input
            type="checkbox"
            checked={settings.automationsEnabled}
            onChange={(event) => setSettings({ ...settings, automationsEnabled: event.target.checked })}
          />
          <span>Enable automations (rule engine kill switch). Broadcast-style manual tests can still run when channels are ready.</span>
        </label>
        <div className="form-grid" style={{ marginTop: 12 }}>
          <Field label="n8n webhook base" hint="Example: http://127.0.0.1:5678/webhook">
            <input value={settings.n8nWebhookBase} onChange={(event) => setSettings({ ...settings, n8nWebhookBase: event.target.value })} placeholder="http://127.0.0.1:5678/webhook" />
          </Field>
          <Field label="Default email CC">
            <input value={settings.emailCc ?? ""} onChange={(event) => setSettings({ ...settings, emailCc: event.target.value })} />
          </Field>
          <Field label="From address (hint for n8n)">
            <input value={settings.emailFromAddress ?? ""} onChange={(event) => setSettings({ ...settings, emailFromAddress: event.target.value })} />
          </Field>
          <Field label="From name (hint for n8n)">
            <input value={settings.emailFromName ?? ""} onChange={(event) => setSettings({ ...settings, emailFromName: event.target.value })} />
          </Field>
        </div>
      </Panel>

      <Panel
        title="WhatsApp · WAHA"
        action={
          <div className="actions">
            <Button size="sm" variant="secondary" onClick={() => actions.checkAutomationHealth("whatsapp")}>Check session</Button>
            <Button size="sm" variant="secondary" onClick={() => { setTestTarget(user?.phone ?? ""); setTestOpen("whatsapp"); }}>Send test</Button>
          </div>
        }
      >
        <Banner tone="info">Individuals use chat ids like 91XXXXXXXXXX@c.us. Invalid mobiles fail the send and are logged.</Banner>
        <div className="form-grid">
          <Field label="API URL">
            <input value={waha.apiUrl} onChange={(event) => setWaha({ ...waha, apiUrl: event.target.value })} placeholder="http://127.0.0.1:3000" />
          </Field>
          <Field label="Session name">
            <input value={waha.sessionName} onChange={(event) => setWaha({ ...waha, sessionName: event.target.value })} />
          </Field>
          <Field label="API key" hint="Sent as X-Api-Key. Stored on the server workspace.">
            <input type="password" value={waha.apiKey} onChange={(event) => setWaha({ ...waha, apiKey: event.target.value })} autoComplete="off" />
          </Field>
          <label className="check" style={{ alignSelf: "end" }}>
            <input type="checkbox" checked={waha.isEnabled} onChange={(event) => setWaha({ ...waha, isEnabled: event.target.checked })} />
            <span>Enable WhatsApp channel</span>
          </label>
        </div>
        {waha.lastHealthCheck && (
          <p className="muted">
            Last check {formatDateTime(waha.lastHealthCheck.checkedAt)} · {waha.lastHealthCheck.status}
            {waha.lastHealthCheck.latencyMs != null ? ` · ${waha.lastHealthCheck.latencyMs} ms` : ""} — {waha.lastHealthCheck.message}
          </p>
        )}
      </Panel>

      <Panel
        title="Email · n8n endpoints"
        action={<Button size="sm" variant="secondary" onClick={() => actions.checkAutomationHealth("email")}>Ping n8n</Button>}
      >
        {endpoints.map((endpoint, index) => (
          <div key={endpoint.id} className="form-grid" style={{ marginBottom: 12 }}>
            <Field label="Label">
              <input
                value={endpoint.label}
                onChange={(event) => {
                  const next = [...endpoints];
                  next[index] = { ...endpoint, label: event.target.value };
                  setEndpoints(next);
                }}
              />
            </Field>
            <Field label="Webhook segment / URL">
              <input
                value={endpoint.webhookUrl}
                onChange={(event) => {
                  const next = [...endpoints];
                  next[index] = { ...endpoint, webhookUrl: event.target.value };
                  setEndpoints(next);
                }}
              />
            </Field>
            <label className="check">
              <input
                type="checkbox"
                checked={endpoint.isEnabled}
                onChange={(event) => {
                  const next = [...endpoints];
                  next[index] = { ...endpoint, isEnabled: event.target.checked };
                  setEndpoints(next);
                }}
              />
              <span>Enabled · {endpoint.provider}</span>
            </label>
          </div>
        ))}
        <div className="actions">
          <Button size="sm" variant="secondary" onClick={() => { setTestTarget(""); setTestOpen("email"); }}>Send test email</Button>
        </div>
      </Panel>

      {error && <Banner tone="error">{error}</Banner>}
      <div className="actions">
        <Button
          onClick={async () => {
            const result = await actions.saveAutomationSettings(settings, waha, endpoints);
            setError(result.ok ? "" : result.message);
          }}
        >
          Save channels
        </Button>
      </div>

      <Modal open={Boolean(testOpen)} title={testOpen === "whatsapp" ? "WhatsApp test" : "Email test"} onClose={() => setTestOpen(null)}>
        <Field label={testOpen === "whatsapp" ? "Mobile" : "Recipient email"}>
          <input value={testTarget} onChange={(event) => setTestTarget(event.target.value)} placeholder={testOpen === "whatsapp" ? "9876543210" : "you@company.com"} />
        </Field>
        <Field label="Message">
          <textarea rows={4} value={testMessage} onChange={(event) => setTestMessage(event.target.value)} />
        </Field>
        <div className="actions">
          <Button variant="secondary" onClick={() => setTestOpen(null)}>Cancel</Button>
          <Button
            onClick={async () => {
              if (!testOpen) return;
              await actions.testAutomationSend({
                channel: testOpen,
                message: testMessage,
                phone: testOpen === "whatsapp" ? testTarget : undefined,
                email: testOpen === "email" ? testTarget : undefined,
              });
              setTestOpen(null);
            }}
          >
            Send test
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Rules() {
  const { user, state, actions } = useApp();
  const config = useConfig();
  const [editor, setEditor] = useState<Partial<AutomationRule> | null>(null);
  const [testRule, setTestRule] = useState<AutomationRule | null>(null);
  const [testTarget, setTestTarget] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [error, setError] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const sorted = useMemo(
    () => [...config.rules].sort((a, b) => a.name.localeCompare(b.name)),
    [config.rules],
  );

  const openRuleTest = (rule: AutomationRule) => {
    setTestRule(rule);
    setTestTarget(rule.channel === "whatsapp" ? (user?.phone ?? "") : (user?.email ?? ""));
  };

  const sampleVars = sampleAutomationVars({
    employeeName: user ? fullName(user) : "Test employee",
    companyName: state.settings.orgName,
    mobile: user?.phone ?? "",
  });

  return (
    <section className="panel automation-rules">
      <div className="panel-toolbar">
        <h2>Automation rules</h2>
        <div className="panel-toolbar-actions">
          <Button
            size="sm"
            onClick={() =>
              setEditor({
                name: "",
                trigger: "leave-submitted",
                channel: "email",
                isActive: false,
                templateSubject: "",
                templateBody: "",
                description: "",
              })
            }
          >
            New rule
          </Button>
        </div>
      </div>
      <DataTable
        caption="Automation rules"
        className="automation-rules-table"
        rows={sorted}
        rowKey={(row) => row.id}
        emptyTitle="No rules"
        emptyBody="Create a rule for an HR event and channel."
        columns={[
          { key: "name", header: "Rule", render: (row) => (<span className="rule-name"><strong>{row.name}</strong><span className="muted">{row.description || TRIGGER_LABELS[row.trigger]}</span></span>) },
          { key: "trigger", header: "Trigger", render: (row) => TRIGGER_LABELS[row.trigger] },
          { key: "channel", header: "Channel", render: (row) => <StatusBadge value={row.channel} /> },
          { key: "active", header: "Status", render: (row) => (row.isActive ? <StatusBadge value="active" /> : <StatusBadge value="inactive" />) },
          {
            key: "actions",
            header: "Actions",
            render: (row) => (
              <div className="actions rule-actions">
                <Button size="sm" variant="secondary" onClick={() => setEditor(row)}>Edit</Button>
                <Button size="sm" variant="secondary" onClick={() => openRuleTest(row)}>Send test</Button>
                <Button size="sm" variant="secondary" onClick={() => actions.setAutomationRuleActive(row.id, !row.isActive)}>
                  {row.isActive ? "Pause" : "Activate"}
                </Button>
              </div>
            ),
          },
        ]}
      />

      <Modal open={Boolean(editor)} title={editor?.id ? "Edit rule" : "New rule"} onClose={() => setEditor(null)}>
        {editor && (
          <>
            <div className="form-grid">
              <Field label="Name" required className="span-2">
                <input value={editor.name ?? ""} onChange={(event) => setEditor({ ...editor, name: event.target.value })} />
              </Field>
              <Field label="Trigger">
                <select value={editor.trigger} onChange={(event) => setEditor({ ...editor, trigger: event.target.value as AutomationTrigger })}>
                  {TRIGGERS.map((trigger) => <option key={trigger} value={trigger}>{TRIGGER_LABELS[trigger]}</option>)}
                </select>
              </Field>
              <Field label="Channel">
                <select value={editor.channel} onChange={(event) => setEditor({ ...editor, channel: event.target.value as "email" | "whatsapp" })}>
                  <option value="email">Email (n8n)</option>
                  <option value="whatsapp">WhatsApp (WAHA)</option>
                </select>
              </Field>
              {editor.channel === "email" && (
                <Field label="Subject template" className="span-2" required>
                  <input value={editor.templateSubject ?? ""} onChange={(event) => setEditor({ ...editor, templateSubject: event.target.value })} />
                </Field>
              )}
              <Field label="Description" className="span-2">
                <input value={editor.description ?? ""} onChange={(event) => setEditor({ ...editor, description: event.target.value })} />
              </Field>
            </div>
            <div className="spread" style={{ marginTop: 8 }}>
              <strong>Message body</strong>
              <div className="actions">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const el = bodyRef.current;
                    if (!el) return;
                    const wrapped = wrapSelection(editor.templateBody ?? "", el.selectionStart, el.selectionEnd, "*");
                    setEditor({ ...editor, templateBody: wrapped.next });
                    requestAnimationFrame(() => el.setSelectionRange(wrapped.selectionStart, wrapped.selectionEnd));
                  }}
                >
                  Bold
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const el = bodyRef.current;
                    if (!el) return;
                    const wrapped = wrapSelection(editor.templateBody ?? "", el.selectionStart, el.selectionEnd, "_");
                    setEditor({ ...editor, templateBody: wrapped.next });
                    requestAnimationFrame(() => el.setSelectionRange(wrapped.selectionStart, wrapped.selectionEnd));
                  }}
                >
                  Italic
                </Button>
              </div>
            </div>
            <textarea
              ref={bodyRef}
              rows={8}
              value={editor.templateBody ?? ""}
              onChange={(event) => setEditor({ ...editor, templateBody: event.target.value })}
            />
            <p className="muted">Variables: {TEMPLATE_VARIABLE_HELP.join(" ")}</p>
            <div className="automation-preview" dangerouslySetInnerHTML={{ __html: markersToPreviewHtml(editor.templateBody ?? "") }} />
            <label className="check">
              <input type="checkbox" checked={Boolean(editor.isActive)} onChange={(event) => setEditor({ ...editor, isActive: event.target.checked })} />
              <span>Active</span>
            </label>
            {error && <Banner tone="error">{error}</Banner>}
            <div className="actions">
              {editor.id && (
                <Button
                  variant="danger"
                  onClick={async () => {
                    const result = await actions.deleteAutomationRule(editor.id!);
                    if (result.ok) setEditor(null);
                    else setError(result.message);
                  }}
                >
                  Delete
                </Button>
              )}
              {editor.id && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    const saved = config.rules.find((item) => item.id === editor.id);
                    if (saved) openRuleTest(saved);
                  }}
                >
                  Send test
                </Button>
              )}
              <Button variant="secondary" onClick={() => setEditor(null)}>Cancel</Button>
              <Button
                onClick={async () => {
                  const result = await actions.saveAutomationRule({
                    id: editor.id,
                    name: editor.name ?? "",
                    description: editor.description,
                    trigger: editor.trigger ?? "leave-submitted",
                    channel: editor.channel ?? "email",
                    isActive: Boolean(editor.isActive),
                    templateSubject: editor.templateSubject,
                    templateBody: editor.templateBody ?? "",
                    emailCc: editor.emailCc,
                    offsetMinutes: editor.offsetMinutes,
                  });
                  if (result.ok) setEditor(null);
                  else setError(result.message);
                }}
              >
                Save rule
              </Button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={Boolean(testRule)} title={testRule ? `Send test · ${testRule.name}` : "Send test"} onClose={() => setTestRule(null)}>
        {testRule && (
          <>
            <Banner tone="info">
              Sends this rule’s rendered template on {testRule.channel === "whatsapp" ? "WhatsApp (WAHA)" : "email (n8n)"} using sample variables. The rule does not need to be active.
            </Banner>
            <p className="muted">{TRIGGER_LABELS[testRule.trigger]} · {testRule.channel}</p>
            {testRule.channel === "email" && (
              <p><strong>Subject:</strong> {renderAutomationTemplate(testRule.templateSubject || testRule.name, sampleVars)}</p>
            )}
            <div className="automation-preview" dangerouslySetInnerHTML={{ __html: markersToPreviewHtml(renderAutomationTemplate(testRule.templateBody, sampleVars)) }} />
            <Field label={testRule.channel === "whatsapp" ? "Mobile" : "Recipient email"} required>
              <input
                value={testTarget}
                onChange={(event) => setTestTarget(event.target.value)}
                placeholder={testRule.channel === "whatsapp" ? "9876543210" : "you@company.com"}
              />
            </Field>
            <div className="actions">
              <Button variant="secondary" onClick={() => setTestRule(null)}>Cancel</Button>
              <Button
                disabled={testBusy || !testTarget.trim()}
                onClick={async () => {
                  setTestBusy(true);
                  const result = await actions.testAutomationSend({
                    ruleId: testRule.id,
                    phone: testRule.channel === "whatsapp" ? testTarget.trim() : undefined,
                    email: testRule.channel === "email" ? testTarget.trim() : undefined,
                  });
                  setTestBusy(false);
                  if (result.ok) setTestRule(null);
                }}
              >
                {testBusy ? "Sending…" : "Send test"}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </section>
  );
}

function Logs() {
  const { actions } = useApp();
  const config = useConfig();
  const [channel, setChannel] = useState("all");
  const rows = config.logs.filter((item) => channel === "all" || item.channel === channel);

  return (
    <section className="panel automation-logs">
      <div className="panel-toolbar">
        <h2>Delivery logs</h2>
        <div className="panel-toolbar-actions">
          <label className="inline-control">
            <span>Channel</span>
            <select value={channel} onChange={(event) => setChannel(event.target.value)} aria-label="Filter by channel">
              <option value="all">All</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
            </select>
          </label>
          <Button variant="secondary" size="sm" onClick={() => actions.clearAutomationLogs()}>Clear logs</Button>
        </div>
      </div>
      <Banner tone="info">HTTP 2xx means the handoff to WAHA or n8n succeeded. End-user delivery can still fail later at WhatsApp or the mail provider.</Banner>
      <DataTable
        caption="Automation logs"
        className="automation-logs-table"
        rows={rows}
        rowKey={(row) => row.id}
        emptyTitle="No logs"
        emptyBody="Attempts appear after events fire or you send a test."
        columns={[
          { key: "when", header: "When", render: (row) => <span className="log-when">{formatDateTime(row.attemptedAt)}</span> },
          { key: "trigger", header: "Trigger", render: (row) => TRIGGER_LABELS[row.trigger] },
          { key: "channel", header: "Channel", render: (row) => <StatusBadge value={row.channel} /> },
          { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
          { key: "summary", header: "Summary", render: (row) => <span className="log-summary">{row.errorMessage || row.responseSummary || "—"}</span> },
        ]}
      />
    </section>
  );
}

function Guide() {
  return (
    <div className="stack-lg">
      <Panel title="How it works">
        <ol className="automation-steps">
          <li>An HR event fires (leave, ticket, expense, payroll, policy, asset) or you send a manual test.</li>
          <li>The server loads automation config from the workspace database (not browser storage).</li>
          <li>Active rules matching the trigger are rendered with {"{{variables}}"}.</li>
          <li>WhatsApp goes to WAHA; email JSON goes to n8n webhooks.</li>
          <li>Each attempt is logged (capped at 500).</li>
        </ol>
      </Panel>
      <Panel title="People triggers available">
        <div className="automation-trigger-grid">
          {TRIGGERS.filter((item) => item !== "manual-test" && item !== "whatsapp-broadcast").map((trigger) => (
            <span key={trigger} className="automation-chip">{TRIGGER_LABELS[trigger]}</span>
          ))}
        </div>
      </Panel>
      <Panel title="Operational limits">
        <ul>
          <li>~400 ms pause between WhatsApp sends</li>
          <li>Media uploads (when added) capped at 25 MB</li>
          <li>Broadcast waves max 50 recipients with 30-minute gaps (campaign UI can extend this later)</li>
          <li>Email delivery depends on your n8n workflow — this app only posts the webhook</li>
        </ul>
        <Banner tone="warning">
          <ShieldAlert size={16} style={{ verticalAlign: "text-bottom", marginRight: 6 }} />
          Do not commit production WAHA API keys. Override hosts per deployment.
        </Banner>
      </Panel>
      <Panel title="Architecture">
        <p className="muted">
          <Radio size={16} style={{ verticalAlign: "text-bottom" }} /> Event / scheduler → match rules → render template → WAHA or n8n → automation log
        </p>
        <p>
          CRM-only modules from Compass (bookings, win-back, payment digests) are not ported here. This page uses the same channel model for Buildesk People HR events.
        </p>
        <p className="muted"><Activity size={16} style={{ verticalAlign: "text-bottom" }} /> Scheduler hooks can be extended later for offset reminders; event-driven paths are live today.</p>
      </Panel>
    </div>
  );
}
