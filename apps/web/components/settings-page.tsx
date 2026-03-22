"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Building2,
  Key,
  Mail,
  Save,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  FadeIn,
  Input,
  Label,
  Select,
  Separator,
  Toggle,
} from "@/components/ui";
import {
  getSettings as apiGetSettings,
  updateSettings as apiUpdateSettings,
  type AppSettingsRecord,
} from "@/lib/api";

const STORAGE_KEY = "bidwright-settings";

type SettingsTab = "general" | "email" | "defaults" | "users" | "integrations";

interface GeneralSettings {
  organizationName: string;
  address: string;
  phone: string;
  website: string;
  logoUrl: string;
}

interface EmailSettings {
  smtpHost: string;
  smtpPort: string;
  smtpUsername: string;
  smtpPassword: string;
  fromAddress: string;
  fromName: string;
}

interface DefaultSettings {
  defaultMarkup: number;
  defaultBreakoutStyle: string;
  defaultQuoteType: string;
}

interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: "Estimator" | "Admin" | "Viewer";
  active: boolean;
}

interface IntegrationSettings {
  openaiApiKey: string;
  anthropicApiKey: string;
  llmProvider: string;
  llmModel: string;
}

interface AllSettings {
  general: GeneralSettings;
  email: EmailSettings;
  defaults: DefaultSettings;
  users: UserRecord[];
  integrations: IntegrationSettings;
}

const DEFAULT_SETTINGS: AllSettings = {
  general: {
    organizationName: "",
    address: "",
    phone: "",
    website: "",
    logoUrl: "",
  },
  email: {
    smtpHost: "",
    smtpPort: "587",
    smtpUsername: "",
    smtpPassword: "",
    fromAddress: "",
    fromName: "",
  },
  defaults: {
    defaultMarkup: 15,
    defaultBreakoutStyle: "category",
    defaultQuoteType: "Firm",
  },
  users: [
    {
      id: "default-user",
      name: "Default Estimator",
      email: "estimator@company.com",
      role: "Admin",
      active: true,
    },
  ],
  integrations: {
    openaiApiKey: "",
    anthropicApiKey: "",
    llmProvider: "anthropic",
    llmModel: "claude-sonnet-4-20250514",
  },
};

const TABS: { key: SettingsTab; label: string; icon: typeof Building2 }[] = [
  { key: "general", label: "General", icon: Building2 },
  { key: "email", label: "Email", icon: Mail },
  { key: "defaults", label: "Defaults", icon: SlidersHorizontal },
  { key: "users", label: "Users", icon: Users },
  { key: "integrations", label: "Integrations", icon: Key },
];

function maskKey(value: string) {
  if (!value || value.length < 8) return value ? "****" : "";
  return value.slice(0, 4) + "****" + value.slice(-4);
}

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [settings, setSettings] = useState<AllSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<AllSettings>;
        setSettings((prev) => ({
          general: { ...prev.general, ...parsed.general },
          email: { ...prev.email, ...parsed.email },
          defaults: { ...prev.defaults, ...parsed.defaults },
          users: parsed.users ?? prev.users,
          integrations: { ...prev.integrations, ...parsed.integrations },
        }));
      }
    } catch {
      // use defaults
    }
  }, []);

  const save = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [settings]);

  const updateGeneral = (patch: Partial<GeneralSettings>) =>
    setSettings((s) => ({ ...s, general: { ...s.general, ...patch } }));
  const updateEmail = (patch: Partial<EmailSettings>) =>
    setSettings((s) => ({ ...s, email: { ...s.email, ...patch } }));
  const updateDefaults = (patch: Partial<DefaultSettings>) =>
    setSettings((s) => ({ ...s, defaults: { ...s.defaults, ...patch } }));
  const updateIntegrations = (patch: Partial<IntegrationSettings>) =>
    setSettings((s) => ({
      ...s,
      integrations: { ...s.integrations, ...patch },
    }));
  const updateUser = (id: string, patch: Partial<UserRecord>) =>
    setSettings((s) => ({
      ...s,
      users: s.users.map((u) => (u.id === id ? { ...u, ...patch } : u)),
    }));
  const addUser = () => {
    const newUser: UserRecord = {
      id: `user-${Date.now()}`,
      name: "",
      email: "",
      role: "Estimator",
      active: true,
    };
    setSettings((s) => ({ ...s, users: [...s.users, newUser] }));
  };

  return (
    <div className="space-y-5">
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-fg">Settings</h1>
            <p className="text-xs text-fg/50">
              Configure your Bidwright workspace
            </p>
          </div>
          <Button variant="accent" size="sm" onClick={save}>
            <Save className="h-3.5 w-3.5" />
            {saved ? "Saved!" : "Save Settings"}
          </Button>
        </div>
      </FadeIn>

      <div className="flex gap-5">
        {/* Tab sidebar */}
        <FadeIn delay={0.05} className="w-48 shrink-0">
          <Card className="overflow-hidden">
            <div className="p-2 space-y-0.5">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors",
                      activeTab === tab.key
                        ? "bg-accent/10 text-accent font-medium"
                        : "text-fg/60 hover:bg-panel2 hover:text-fg/80"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </Card>
        </FadeIn>

        {/* Tab content */}
        <FadeIn delay={0.1} className="min-w-0 flex-1">
          {activeTab === "general" && (
            <Card>
              <CardHeader>
                <CardTitle>General Settings</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <div>
                  <Label>Organization Name</Label>
                  <Input
                    value={settings.general.organizationName}
                    onChange={(e) =>
                      updateGeneral({ organizationName: e.target.value })
                    }
                    placeholder="Your Company, Inc."
                  />
                </div>
                <div>
                  <Label>Address</Label>
                  <Input
                    value={settings.general.address}
                    onChange={(e) =>
                      updateGeneral({ address: e.target.value })
                    }
                    placeholder="123 Main St, City, State, ZIP"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Phone</Label>
                    <Input
                      value={settings.general.phone}
                      onChange={(e) =>
                        updateGeneral({ phone: e.target.value })
                      }
                      placeholder="(555) 123-4567"
                    />
                  </div>
                  <div>
                    <Label>Website</Label>
                    <Input
                      value={settings.general.website}
                      onChange={(e) =>
                        updateGeneral({ website: e.target.value })
                      }
                      placeholder="https://yourcompany.com"
                    />
                  </div>
                </div>
                <div>
                  <Label>Logo URL</Label>
                  <Input
                    value={settings.general.logoUrl}
                    onChange={(e) =>
                      updateGeneral({ logoUrl: e.target.value })
                    }
                    placeholder="https://yourcompany.com/logo.png"
                  />
                </div>
              </CardBody>
            </Card>
          )}

          {activeTab === "email" && (
            <Card>
              <CardHeader>
                <CardTitle>Email (SMTP) Settings</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>SMTP Host</Label>
                    <Input
                      value={settings.email.smtpHost}
                      onChange={(e) =>
                        updateEmail({ smtpHost: e.target.value })
                      }
                      placeholder="smtp.gmail.com"
                    />
                  </div>
                  <div>
                    <Label>Port</Label>
                    <Input
                      value={settings.email.smtpPort}
                      onChange={(e) =>
                        updateEmail({ smtpPort: e.target.value })
                      }
                      placeholder="587"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Username</Label>
                    <Input
                      value={settings.email.smtpUsername}
                      onChange={(e) =>
                        updateEmail({ smtpUsername: e.target.value })
                      }
                      placeholder="user@gmail.com"
                    />
                  </div>
                  <div>
                    <Label>Password</Label>
                    <Input
                      type="password"
                      value={settings.email.smtpPassword}
                      onChange={(e) =>
                        updateEmail({ smtpPassword: e.target.value })
                      }
                      placeholder="********"
                    />
                  </div>
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>From Address</Label>
                    <Input
                      value={settings.email.fromAddress}
                      onChange={(e) =>
                        updateEmail({ fromAddress: e.target.value })
                      }
                      placeholder="quotes@yourcompany.com"
                    />
                  </div>
                  <div>
                    <Label>From Name</Label>
                    <Input
                      value={settings.email.fromName}
                      onChange={(e) =>
                        updateEmail({ fromName: e.target.value })
                      }
                      placeholder="Your Company Quotes"
                    />
                  </div>
                </div>
              </CardBody>
            </Card>
          )}

          {activeTab === "defaults" && (
            <Card>
              <CardHeader>
                <CardTitle>Default Values</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <div>
                  <Label>Default Markup (%)</Label>
                  <Input
                    type="number"
                    value={settings.defaults.defaultMarkup}
                    onChange={(e) =>
                      updateDefaults({
                        defaultMarkup: parseFloat(e.target.value) || 0,
                      })
                    }
                    placeholder="15"
                  />
                </div>
                <div>
                  <Label>Default Breakout Style</Label>
                  <Select
                    value={settings.defaults.defaultBreakoutStyle}
                    onChange={(e) =>
                      updateDefaults({
                        defaultBreakoutStyle: e.target.value,
                      })
                    }
                  >
                    <option value="category">By Category</option>
                    <option value="phase">By Phase</option>
                    <option value="worksheet">By Worksheet</option>
                    <option value="flat">Flat (No Breakout)</option>
                  </Select>
                </div>
                <div>
                  <Label>Default Quote Type</Label>
                  <Select
                    value={settings.defaults.defaultQuoteType}
                    onChange={(e) =>
                      updateDefaults({ defaultQuoteType: e.target.value })
                    }
                  >
                    <option value="Firm">Firm</option>
                    <option value="Budget">Budget</option>
                    <option value="BudgetDNE">Budget DNE</option>
                  </Select>
                </div>
              </CardBody>
            </Card>
          )}

          {activeTab === "users" && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Users</CardTitle>
                <Button variant="accent" size="xs" onClick={addUser}>
                  <Users className="h-3 w-3" />
                  Add User
                </Button>
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="px-5 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40">
                        Name
                      </th>
                      <th className="px-5 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40">
                        Email
                      </th>
                      <th className="px-5 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40 w-36">
                        Role
                      </th>
                      <th className="px-5 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40 w-20">
                        Active
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {settings.users.map((user) => (
                      <tr
                        key={user.id}
                        className="border-b border-line last:border-0"
                      >
                        <td className="px-5 py-2.5">
                          <Input
                            className="h-7 text-xs"
                            value={user.name}
                            onChange={(e) =>
                              updateUser(user.id, { name: e.target.value })
                            }
                            placeholder="Full name"
                          />
                        </td>
                        <td className="px-5 py-2.5">
                          <Input
                            className="h-7 text-xs"
                            value={user.email}
                            onChange={(e) =>
                              updateUser(user.id, { email: e.target.value })
                            }
                            placeholder="email@company.com"
                          />
                        </td>
                        <td className="px-5 py-2.5">
                          <Select
                            className="h-7 text-xs"
                            value={user.role}
                            onChange={(e) =>
                              updateUser(user.id, {
                                role: e.target.value as UserRecord["role"],
                              })
                            }
                          >
                            <option value="Estimator">Estimator</option>
                            <option value="Admin">Admin</option>
                            <option value="Viewer">Viewer</option>
                          </Select>
                        </td>
                        <td className="px-5 py-2.5">
                          <Toggle
                            checked={user.active}
                            onChange={(val) =>
                              updateUser(user.id, { active: val })
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {activeTab === "integrations" && (
            <Card>
              <CardHeader>
                <CardTitle>Integrations &amp; API Keys</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <div>
                  <Label>LLM Provider</Label>
                  <Select
                    value={settings.integrations.llmProvider}
                    onChange={(e) =>
                      updateIntegrations({ llmProvider: e.target.value })
                    }
                  >
                    <option value="anthropic">Anthropic</option>
                    <option value="openai">OpenAI</option>
                  </Select>
                </div>
                <div>
                  <Label>Model</Label>
                  <Select
                    value={settings.integrations.llmModel}
                    onChange={(e) =>
                      updateIntegrations({ llmModel: e.target.value })
                    }
                  >
                    {settings.integrations.llmProvider === "anthropic" ? (
                      <>
                        <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
                        <option value="claude-opus-4-20250514">Claude Opus 4</option>
                        <option value="claude-3-5-haiku-20241022">Claude 3.5 Haiku</option>
                      </>
                    ) : (
                      <>
                        <option value="gpt-4o">GPT-4o</option>
                        <option value="gpt-4o-mini">GPT-4o Mini</option>
                        <option value="o1-preview">o1 Preview</option>
                      </>
                    )}
                  </Select>
                </div>
                <Separator />
                <div>
                  <Label>Anthropic API Key</Label>
                  <Input
                    type="password"
                    value={settings.integrations.anthropicApiKey}
                    onChange={(e) =>
                      updateIntegrations({
                        anthropicApiKey: e.target.value,
                      })
                    }
                    placeholder="sk-ant-***"
                  />
                  {settings.integrations.anthropicApiKey && (
                    <p className="mt-1 text-[11px] text-fg/40">
                      Current: {maskKey(settings.integrations.anthropicApiKey)}
                    </p>
                  )}
                </div>
                <div>
                  <Label>OpenAI API Key</Label>
                  <Input
                    type="password"
                    value={settings.integrations.openaiApiKey}
                    onChange={(e) =>
                      updateIntegrations({
                        openaiApiKey: e.target.value,
                      })
                    }
                    placeholder="sk-***"
                  />
                  {settings.integrations.openaiApiKey && (
                    <p className="mt-1 text-[11px] text-fg/40">
                      Current: {maskKey(settings.integrations.openaiApiKey)}
                    </p>
                  )}
                </div>
              </CardBody>
            </Card>
          )}
        </FadeIn>
      </div>
    </div>
  );
}
