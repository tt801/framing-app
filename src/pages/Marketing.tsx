/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps, prefer-const */
// src/pages/Marketing.tsx
import React, { useMemo, useState, useEffect } from "react";
import { useQuotes } from "@/lib/quotes";
import { useCustomers } from "@/lib/customers";
import { useJobs } from "@/lib/jobs";
import { useToast } from "@/lib/toast";
import { useHistory } from "@/lib/history";
import { getAccessToken } from "@/lib/supabase";

/** Minimal inline icons (no external deps) */
const Icon = {
  Mail: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M4 4h16v16H4z" />
      <path d="m4 7 8 5 8-5" />
    </svg>
  ),
  Link2: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M10 13a5 5 0 0 1 0-7l1.5-1.5a5 5 0 0 1 7 7L17 12" />
      <path d="M14 11a5 5 0 0 1 0 7L12.5 20.5a5 5 0 0 1-7-7L7 12" />
    </svg>
  ),
  MessageSquare: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M21 15a4 4 0 0 1-4 4H8l-4 3V7a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4z" />
    </svg>
  ),
  ShoppingCart: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <circle cx="9" cy="20" r="1" />
      <circle cx="17" cy="20" r="1" />
      <path d="M3 3h2l2 12h11l2-8H6" />
    </svg>
  ),
  Megaphone: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M3 11v2a3 3 0 0 0 3 3h1l3 4v-7l10-4V7L10 11H6a3 3 0 0 1-3-3" />
    </svg>
  ),
  Phone: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07A19.5 19.5 0 0 1 3.15 9.81 19.86 19.86 0 0 1 .08 1.18 2 2 0 0 1 2.05 0h3a2 2 0 0 1 2 1.72c.12.89.31 1.76.57 2.6a2 2 0 0 1-.45 2.11L6 8a16 16 0 0 0 10 10l1.57-1.17a2 2 0 0 1 2.11-.45c.84.26 1.71.45 2.6.57A2 2 0 0 1 22 16.92z" />
    </svg>
  ),
  Star: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="m12 17.27 6.18 3.73-1.64-7.03 5.46-4.73-7.19-.62L12 2 9.19 8.62l-7.19.62 5.46 4.73L5.82 21z" />
    </svg>
  ),
  Calendar: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  ),
  Zap: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M13 2 3 14h7l-1 8 11-12h-7l1-8z" />
    </svg>
  ),
  Users: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  Target: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M2 12h2M20 12h2M12 20v2" />
    </svg>
  ),
  CheckCircle: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
};

type CardProps = {
  title: string;
  icon: keyof typeof Icon;
  children: React.ReactNode;
};

function Card({ title, icon, children }: CardProps) {
  const Ico = Icon[icon];
  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="mb-3 flex items-center gap-2">
        <Ico width={18} height={18} className="text-slate-700" />
        <h3 className="text-base font-semibold">{title}</h3>
      </div>
      {children}
    </section>
  );
}

type Campaign = {
  id: string;
  name: string;
  channel: string;
  start: string;
  status: "Planned" | "Live" | "Completed";
};

export default function MarketingPage() {
  // Defensive access to stores so we don't break anything
  const quotesStore: any = useQuotes();
  const customersStore: any = useCustomers();
  const jobsStore: any = useJobs();
  const { add: toast } = useToast();
  const { add: addToHistory, canUndo, undo } = useHistory();

  const quotes: any[] = quotesStore?.quotes || quotesStore?.items || [];
  const customers: any[] = customersStore?.customers || customersStore?.items || [];
  const jobs: any[] = jobsStore?.jobs || jobsStore?.items || [];

  const getAuthHeaders = async () => {
    const token = await getAccessToken();
    if (!token) {
      throw new Error("Please sign in to send marketing automations.");
    }
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  };

  const [plannedCampaigns, setPlannedCampaigns] = useState<Campaign[]>([
    {
      id: rid(),
      name: "Graduation & Year-end framing",
      channel: "Email + Instagram",
      start: nextMonthIso(),
      status: "Planned",
    },
  ]);

  const [reviewLinks, setReviewLinks] = useState({
    google: "",
    facebook: "",
    instagram: "",
  });

  // Automation Settings State
  const [automationSettings, setAutomationSettings] = useState(() => {
    const stored = localStorage.getItem("marketing.automation.settings.v1");
    return stored
      ? JSON.parse(stored)
      : {
          enabled: false,
          channel: "email" as "whatsapp" | "email" | "mailchimp",
          reviewRequestEnabled: true,
          quoteFollowupEnabled: true,
          apiConfigured: false,
        };
  });

  const saveAutomationSettings = (settings: any) => {
    setAutomationSettings(settings);
    localStorage.setItem("marketing.automation.settings.v1", JSON.stringify(settings));
  };

  // Custom Campaigns State
  interface Campaign {
    id: string;
    name: string;
    description: string;
    targetAudience: string; // 'recent', 'lapsed', 'repeat', 'all', 'custom'
    channel: "whatsapp" | "email" | "mailchimp";
    messageTemplate: string;
    daysOld?: number; // for automation timing
    customCustomerIds?: string[]; // for custom selections
    createdAt: string;
    enabled: boolean;
  }

  const [campaigns, setCampaigns] = useState<Campaign[]>(() => {
    const stored = localStorage.getItem("marketing.campaigns.v1");
    return stored ? JSON.parse(stored) : [];
  });

  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [showNewCampaignForm, setShowNewCampaignForm] = useState(false);
  const [schedulingCampaignId, setSchedulingCampaignId] = useState<string | null>(null);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [scheduledSends, setScheduledSends] = useState<any[]>(() => {
    const stored = localStorage.getItem("marketing.scheduled.sends.v1");
    return stored ? JSON.parse(stored) : [];
  });

  const saveCampaign = (campaign: Campaign) => {
    const updated = campaigns.map((c) => (c.id === campaign.id ? campaign : c));
    setCampaigns(updated);
    localStorage.setItem("marketing.campaigns.v1", JSON.stringify(updated));
    setEditingCampaign(null);
    toast(`Campaign "${campaign.name}" saved`, "success");
  };

  const addCampaign = (campaign: Omit<Campaign, "id" | "createdAt">) => {
    const newCampaign: Campaign = {
      ...campaign,
      id: `campaign-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    const updated = [...campaigns, newCampaign];
    setCampaigns(updated);
    localStorage.setItem("marketing.campaigns.v1", JSON.stringify(updated));
    setShowNewCampaignForm(false);
    toast(`Campaign "${newCampaign.name}" created`, "success");
  };

  const deleteCampaign = (id: string) => {
    const campaign = campaigns.find((c) => c.id === id);
    const backup = campaign;
    const updated = campaigns.filter((c) => c.id !== id);
    setCampaigns(updated);
    localStorage.setItem("marketing.campaigns.v1", JSON.stringify(updated));
    toast(`Campaign "${campaign?.name}" deleted`, "error");
    addToHistory({
      id: `delete-campaign-${id}`,
      name: `Delete ${campaign?.name}`,
      undo: () => {
        if (backup) {
          const restored = [...campaigns, backup];
          setCampaigns(restored);
          localStorage.setItem("marketing.campaigns.v1", JSON.stringify(restored));
        }
      },
      redo: () => {
        deleteCampaign(id);
      },
    });
  };

  const setupCampaign = (campaign: Campaign) => {
    // Open edit mode for this campaign
    setEditingCampaign(campaign);
  };

  const updateEditingCampaign = (updates: Partial<Campaign>) => {
    if (!editingCampaign) return;
    setEditingCampaign({ ...editingCampaign, ...updates });
  };

  const saveEditingCampaign = () => {
    if (!editingCampaign) return;
    const updated = campaigns.map((c) => (c.id === editingCampaign.id ? editingCampaign : c));
    setCampaigns(updated);
    localStorage.setItem("marketing.campaigns.v1", JSON.stringify(updated));
    setEditingCampaign(null);
    toast(`Campaign "${editingCampaign.name}" updated`, "success");
  };

  const scheduleCampaignSend = (campaignId: string, sendDateTime: string) => {
    const campaign = campaigns.find((c) => c.id === campaignId);
    if (!campaign) {
      toast("Campaign not found", "error");
      return;
    }

    const scheduledSend = {
      id: `scheduled-${Date.now()}`,
      campaignId,
      campaignName: campaign.name,
      scheduledFor: sendDateTime,
      createdAt: new Date().toISOString(),
      status: "pending",
    };

    const updated = [...scheduledSends, scheduledSend];
    setScheduledSends(updated);
    localStorage.setItem("marketing.scheduled.sends.v1", JSON.stringify(updated));
    setSchedulingCampaignId(null);
    
    const sendDate = new Date(sendDateTime);
    toast(`✓ Campaign scheduled for ${sendDate.toLocaleString()}`, "success");
  };

  const cancelScheduledSend = (scheduledId: string) => {
    const updated = scheduledSends.filter((s) => s.id !== scheduledId);
    setScheduledSends(updated);
    localStorage.setItem("marketing.scheduled.sends.v1", JSON.stringify(updated));
    toast("Scheduled send cancelled", "success");
  };

  const getRecipientCount = (audience: string, customCustomerIds?: string[]): number => {
    const now = new Date();
    switch (audience) {
      case "recent":
        return jobs.filter((j) => {
          const d = new Date(j?.createdAt || j?.date);
          const daysAgo = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
          return daysAgo <= 7;
        }).length;
      case "pending-quotes":
        return quotes.filter((q) => {
          const d = new Date(q?.createdAt || q?.date);
          const daysAgo = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
          return daysAgo >= 7 && daysAgo <= 30;
        }).length;
      case "repeat":
        return customers.filter((c) => {
          const jobs = (c?.jobs || []).length;
          return jobs >= 2;
        }).length;
      case "lapsed":
        return customers.filter((c) => {
          const d = new Date(c?.lastJobDate || c?.lastInvoiceDate || c?.updatedAt);
          const daysAgo = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
          return daysAgo >= 180;
        }).length;
      case "all":
        return customers.length;
      case "custom":
        return customCustomerIds?.length || 0;
      default:
        return 0;
    }
  };

  const testAutomation = async (type: "review" | "followup") => {
    try {
      const endpoint =
        type === "review"
          ? "/api/automations/send-review-request"
          : "/api/automations/send-quote-followup";

      const testData =
        type === "review"
          ? {
              customerName: "Test Customer",
              customerEmail: "test@example.com",
              customerPhone: "+1234567890",
              jobCompletedDate: new Date().toISOString(),
              channel: automationSettings.channel,
              reviewLinks,
            }
          : {
              customerName: "Test Customer",
              customerEmail: "test@example.com",
              customerPhone: "+1234567890",
              quotedItem: "Sample Frame",
              quoteDate: new Date().toISOString(),
              daysOld: 7,
              channel: automationSettings.channel,
            };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: await getAuthHeaders(),
        body: JSON.stringify(testData),
      });

      const result = await response.json();

      if (response.ok) {
        toast(`Test ${type === "review" ? "review request" : "quote follow-up"} sent successfully!`, "success");
      } else {
        toast(result.error || "Test failed. Check API configuration.", "error");
      }
    } catch (error) {
      toast("Test failed. Make sure serverless functions are deployed.", "error");
    }
  };

  const sendCampaignNow = async (campaign: Campaign) => {
    try {
      // Get matching recipients based on target audience
      const now = new Date();
      let recipientEmails: string[] = [];
      let recipientPhones: string[] = [];

      switch (campaign.targetAudience) {
        case "recent":
          recipientEmails = jobs
            .filter((j) => {
              const d = new Date(j?.createdAt || j?.date);
              const daysAgo = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
              return daysAgo <= 7;
            })
            .map((j) => j?.customerEmail || j?.customer?.email || "")
            .filter(Boolean);
          break;
        case "pending-quotes":
          recipientEmails = quotes
            .filter((q) => {
              const d = new Date(q?.createdAt || q?.date);
              const daysAgo = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
              return daysAgo >= 7 && daysAgo <= 30;
            })
            .map((q) => q?.customerEmail || q?.customer?.email || "")
            .filter(Boolean);
          break;
        case "repeat":
          recipientEmails = customers
            .filter((c) => (c?.jobs || []).length >= 2)
            .map((c) => c?.email || "")
            .filter(Boolean);
          break;
        case "lapsed":
          recipientEmails = customers
            .filter((c) => {
              const d = new Date(c?.lastJobDate || c?.lastInvoiceDate || c?.updatedAt);
              const daysAgo = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
              return daysAgo >= 180;
            })
            .map((c) => c?.email || "")
            .filter(Boolean);
          break;
        case "all":
          recipientEmails = customers
            .map((c) => c?.email || "")
            .filter(Boolean);
          break;
        case "custom":
          if (campaign.customCustomerIds && campaign.customCustomerIds.length > 0) {
            recipientEmails = customers
              .filter((c) => campaign.customCustomerIds!.includes(c?.id || ""))
              .map((c) => c?.email || "")
              .filter(Boolean);
          }
          break;
      }

      if (recipientEmails.length === 0) {
        toast(`No matching recipients found for ${campaign.targetAudience} audience`, "warning");
        return;
      }

      // Call the campaign sending API
      const response = await fetch("/api/automations/send-campaign", {
        method: "POST",
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          campaignId: campaign.id,
          campaignName: campaign.name,
          message: campaign.messageTemplate,
          channel: campaign.channel,
          recipientEmails,
          recipientPhones,
        }),
      });

      const result = await response.json();

      if (response.ok) {
        toast(
          `✓ Campaign sent to ${result.sent || recipientEmails.length} recipients via ${campaign.channel}!`,
          "success"
        );

        // Log campaign send
        const sendLogs = JSON.parse(localStorage.getItem("marketing.campaign.sends.v1") || "[]");
        sendLogs.push({
          campaignId: campaign.id,
          campaignName: campaign.name,
          sentAt: new Date().toISOString(),
          channel: campaign.channel,
          recipientCount: result.sent || recipientEmails.length,
        });
        localStorage.setItem("marketing.campaign.sends.v1", JSON.stringify(sendLogs));
      } else {
        toast(result.error || "Campaign send failed. Check API configuration.", "error");
      }
    } catch (error) {
      console.error("Campaign send error:", error);
      toast("Campaign send failed. Make sure API endpoint is configured.", "error");
    }
  };
  interface Template {
    id: string;
    name: string;
    content: string;
    category: string;
    color: string;
  }

  const defaultTemplates: Template[] = [
    {
      id: "template-1",
      name: "Day 1 Quote Follow-up",
      content: "Hi [Name], thanks for the quote request! We'll have your estimate ready soon.",
      category: "Quote Follow-up",
      color: "slate",
    },
    {
      id: "template-2",
      name: "Day 7 Quote Follow-up",
      content: "Hi [Name], still interested in framing your [item]? We have some new frame options in stock.",
      category: "Quote Follow-up",
      color: "slate",
    },
    {
      id: "template-3",
      name: "Day 14 Quote Follow-up",
      content: "Special offer: 10% off your frame order this week only. Let's turn that quote into beautiful framed art!",
      category: "Quote Follow-up",
      color: "slate",
    },
    {
      id: "template-4",
      name: "Review Request",
      content: "Hi [Name], your frame is ready! Would you mind sharing a quick review? Your feedback helps us improve.",
      category: "Reviews",
      color: "green",
    },
    {
      id: "template-5",
      name: "Repeat Customer - New Stock",
      content: "Hi [Name], we have new [frame style] in stock. Since you loved [previous item] with us, thought you'd like to see these!",
      category: "Repeat Customers",
      color: "blue",
    },
    {
      id: "template-6",
      name: "Repeat Customer - Cross-sell",
      content: "Hi [Name], remember we also offer [glazing/moulding type]? Perfect for [relevant occasion]. Quote attached.",
      category: "Repeat Customers",
      color: "blue",
    },
    {
      id: "template-7",
      name: "Referral Incentive",
      content: "Hi [Name], know someone who needs custom framing? Send them our way and you both get 15% off your next order!",
      category: "Referrals",
      color: "purple",
    },
  ];

  const [templates, setTemplates] = useState<Template[]>(() => {
    const stored = localStorage.getItem("marketing.templates.v1");
    return stored ? JSON.parse(stored) : defaultTemplates;
  });

  type TemplateSend = {
    id: string;
    templateId: string;
    templateName: string;
    recipientEmail: string;
    recipientName: string;
    channel: "email" | "whatsapp";
    status: "sent" | "failed";
    timestamp: string;
  };

  const [templateSends, setTemplateSends] = useState<TemplateSend[]>(() => {
    const stored = localStorage.getItem("marketing.template.sends.v1");
    return stored ? JSON.parse(stored) : [];
  });

  const logTemplateSend = (send: Omit<TemplateSend, "id" | "timestamp">) => {
    const newSend: TemplateSend = {
      ...send,
      id: `send-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date().toISOString(),
    };
    const updated = [newSend, ...templateSends];
    setTemplateSends(updated);
    localStorage.setItem("marketing.template.sends.v1", JSON.stringify(updated));
  };

  const [editingId, setEditingId] = useState<string | null>(null);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateContent, setNewTemplateContent] = useState("");
  const [newTemplateCategory, setNewTemplateCategory] = useState("Custom");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sendingTemplateId, setSendingTemplateId] = useState<string | null>(null);
  const [sendingChannel, setSendingChannel] = useState<"email" | "whatsapp" | null>(null);
  const [sendingRecipients, setSendingRecipients] = useState<string[]>([]);
  const [sendingContent, setSendingContent] = useState("");

  const saveTemplates = (updated: Template[]) => {
    setTemplates(updated);
    localStorage.setItem("marketing.templates.v1", JSON.stringify(updated));
  };

  const copyToClipboard = (text: string, templateId: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(templateId);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const addTemplate = () => {
    if (newTemplateName.trim() && newTemplateContent.trim()) {
      const newTemplate: Template = {
        id: `template-${Date.now()}`,
        name: newTemplateName,
        content: newTemplateContent,
        category: newTemplateCategory,
        color: "slate",
      };
      saveTemplates([...templates, newTemplate]);
      setNewTemplateName("");
      setNewTemplateContent("");
      setNewTemplateCategory("Custom");
    }
  };

  const updateTemplate = (id: string, updates: Partial<Template>) => {
    saveTemplates(
      templates.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
    setEditingId(null);
  };

  const deleteTemplate = (id: string) => {
    saveTemplates(templates.filter((t) => t.id !== id));
  };

  const openTemplateSender = (templateId: string, channel: "email" | "whatsapp") => {
    const template = templates.find((t) => t.id === templateId);
    if (template) {
      setSendingTemplateId(templateId);
      setSendingChannel(channel);
      setSendingContent(template.content);
      setSendingRecipients([]);
    }
  };

  const closeTemplateSender = () => {
    setSendingTemplateId(null);
    setSendingChannel(null);
    setSendingContent("");
    setSendingRecipients([]);
  };

  const sendTemplate = async () => {
    if (!sendingChannel || sendingRecipients.length === 0 || !sendingContent) {
      toast("Please select recipients and ensure content is not empty", "error");
      return;
    }

    try {
      const template = templates.find((t) => t.id === sendingTemplateId);
      
      // Get customer emails for selected recipients
      const selectedCustomers = customers.filter((c) => sendingRecipients.includes(c.id));
      const recipientEmails = selectedCustomers
        .map((c) => c.email)
        .filter(Boolean);

      if (recipientEmails.length === 0) {
        toast("No valid email addresses found for selected customers", "error");
        return;
      }

      const response = await fetch("/api/automations/send-campaign", {
        method: "POST",
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          channel: sendingChannel,
          recipients: recipientEmails,
          messageTemplate: sendingContent,
          templateType: "template",
        }),
      });

      const data = await response.json();
      if (data.success) {
        // Log each send
        selectedCustomers.forEach((customer) => {
          if (customer.email) {
            logTemplateSend({
              templateId: sendingTemplateId || "",
              templateName: template?.name || "Unknown",
              recipientEmail: customer.email,
              recipientName: `${customer.firstName || ""} ${customer.lastName || ""}`.trim() || "Unknown",
              channel: sendingChannel,
              status: "sent",
            });
          }
        });
        
        toast(`Template sent to ${recipientEmails.length} recipient(s) via ${sendingChannel}`, "success");
        closeTemplateSender();
      } else {
        // Log failed sends
        selectedCustomers.forEach((customer) => {
          if (customer.email) {
            logTemplateSend({
              templateId: sendingTemplateId || "",
              templateName: template?.name || "Unknown",
              recipientEmail: customer.email,
              recipientName: `${customer.firstName || ""} ${customer.lastName || ""}`.trim() || "Unknown",
              channel: sendingChannel,
              status: "failed",
            });
          }
        });
        toast(data.message || "Failed to send template", "error");
      }
    } catch (error) {
      console.error("Error sending template:", error);
      toast("Error sending template", "error");
    }
  };

  const metrics = useMemo(() => {
    const n = (v: any, fb = 0) => {
      const x = typeof v === "string" ? parseFloat(v) : Number(v);
      return Number.isFinite(x) ? x : fb;
    };

    const parseDate = (v: any): Date | null => {
      if (!v) return null;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const days30ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const quotesThisMonth = quotes.filter((q) => {
      const d = parseDate(q?.createdAt || q?.date || q?.updatedAt);
      return d && d >= startOfMonth;
    });

    const jobsThisMonth = jobs.filter((j) => {
      const d = parseDate(j?.createdAt || j?.date || j?.updatedAt);
      return d && d >= startOfMonth;
    });

    const conversion =
      quotesThisMonth.length > 0
        ? Math.round((jobsThisMonth.length / quotesThisMonth.length) * 100)
        : 0;

    const avgJobValue = (() => {
      const totals = jobs
        .map((j) => n(j?.total || j?.grandTotal || j?.amount))
        .filter((v) => v > 0);
      if (!totals.length) return 0;
      const sum = totals.reduce((a, b) => a + b, 0);
      return Math.round((sum / totals.length) * 10) / 10;
    })();

    const activeCustomers = customers.filter((c) => {
      const d = parseDate(c?.lastJobDate || c?.lastInvoiceDate || c?.updatedAt);
      return d && d >= days30ago;
    }).length;

    // TIER 1: Revenue Impact Metrics
    // Count repeat customers (those with 2+ jobs)
    const repeatCustomerMap = new Map<string, number>();
    jobs.forEach((j) => {
      const custId = j?.customerId || j?.customer?.id;
      if (custId) {
        repeatCustomerMap.set(custId, (repeatCustomerMap.get(custId) || 0) + 1);
      }
    });
    const repeatCustomers = Array.from(repeatCustomerMap.values()).filter((count) => count >= 2).length;

    // Revenue from repeat customers
    const repeatRevenue = jobs
      .filter((j) => {
        const custId = j?.customerId || j?.customer?.id;
        return custId && (repeatCustomerMap.get(custId) || 0) >= 2;
      })
      .reduce((sum, j) => sum + n(j?.total || j?.grandTotal || j?.amount), 0);

    // Average days from quote to job
    const quoteToJobDays = (() => {
      const durations: number[] = [];
      jobs.forEach((j) => {
        const jobDate = parseDate(j?.createdAt || j?.date);
        const quoteId = j?.quoteId;
        if (jobDate && quoteId) {
          const quote = quotes.find((q) => q.id === quoteId);
          const quoteDate = quote ? parseDate(quote?.createdAt || quote?.date) : null;
          if (quoteDate) {
            const days = Math.ceil((jobDate.getTime() - quoteDate.getTime()) / (1000 * 60 * 60 * 24));
            if (days >= 0 && days <= 180) durations.push(days);
          }
        }
      });
      return durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    })();

    // Customer lifetime value by segment (repeat customers)
    const repeatCustomerValue =
      repeatCustomers > 0 ? Math.round((repeatRevenue / repeatCustomers) * 10) / 10 : 0;

    // Total all-time revenue
    const totalRevenue = jobs.reduce((sum, j) => sum + n(j?.total || j?.grandTotal || j?.amount), 0);

    // Conversion funnel: all quotes → jobs → repeat customers
    const totalQuotes = quotes.length;
    const totalJobs = jobs.length;
    const quoteToJobPercent = totalQuotes > 0 ? Math.round((totalJobs / totalQuotes) * 100) : 0;
    const jobToRepeatPercent = totalJobs > 0 ? Math.round((repeatCustomers / totalJobs) * 100) : 0;

    return {
      quotesThisMonth: quotesThisMonth.length,
      jobsThisMonth: jobsThisMonth.length,
      conversion,
      avgJobValue,
      activeCustomers,
      // TIER 1 additions
      repeatCustomers,
      repeatRevenue,
      repeatCustomerValue,
      quoteToJobDays,
      totalRevenue,
      totalQuotes,
      totalJobs,
      quoteToJobPercent,
      jobToRepeatPercent,
    };
  }, [quotes, jobs, customers]);

  // Audience segments (simple, based on counts + dates)
  const segments = useMemo(() => {
    const parseDate = (v: any): Date | null => {
      if (!v) return null;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const now = new Date();
    const days30ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const days180ago = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

    let warmLeads = 0;
    let lapsed = 0;
    let vip = 0;

    customers.forEach((c) => {
      const jobsCount = c?.jobCount ?? c?.jobs?.length ?? 0;
      const d = parseDate(c?.lastJobDate || c?.lastInvoiceDate || c?.updatedAt);

      if (jobsCount >= 3) vip += 1;
      if (d && d >= days30ago) warmLeads += 1;
      if (d && d < days180ago) lapsed += 1;
    });

    return { warmLeads, lapsed, vip };
  }, [customers]);

  const addPlannedCampaign = () => {
    setPlannedCampaigns((prev) => [
      ...prev,
      {
        id: rid(),
        name: "",
        channel: "",
        start: "",
        status: "Planned",
      },
    ]);
  };

  const updatePlannedCampaign = (id: string, patch: Partial<Campaign>) => {
    setPlannedCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const removePlannedCampaign = (id: string) => {
    setPlannedCampaigns((prev) => prev.filter((c) => c.id !== id));
  };

  const exportLapsedCustomersCSV = () => {
    const now = new Date();
    const days180ago = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

    const parseDate = (v: any): Date | null => {
      if (!v) return null;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const lapsedList = customers.filter((c) => {
      const d = parseDate(c?.lastJobDate || c?.lastInvoiceDate || c?.updatedAt);
      return d && d < days180ago;
    });

    if (!lapsedList.length) {
      toast("No lapsed customers found (6+ months since last job/invoice)", "info");
      return;
    }

    const rows: string[][] = [];
    rows.push(["name", "email", "phone", "lastActivityDate", "notes"]);

    lapsedList.forEach((c) => {
      const firstName = c?.firstName || "";
      const lastName = c?.lastName || "";
      const combined = `${firstName} ${lastName}`.trim();
      const name = c?.name || c?.fullName || combined || "Customer";

      const email =
        c?.email || c?.emailAddress || c?.contactEmail || c?.primaryEmail || "";
      const phone =
        c?.phone || c?.mobile || c?.mobileNumber || c?.phoneNumber || "";

      const d = parseDate(c?.lastJobDate || c?.lastInvoiceDate || c?.updatedAt);
      const lastActivityDate = d ? d.toISOString().slice(0, 10) : "";

      const notes = "Segment: Lapsed (6+ months since last job/invoice)";

      rows.push([
        csvEscape(name),
        csvEscape(email),
        csvEscape(phone),
        csvEscape(lastActivityDate),
        csvEscape(notes),
      ]);
    });

    const csv = rows.map((r) => r.join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "frameit-lapsed-customers.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    window.alert(
      `Exported ${lapsedList.length} lapsed customers.\n\nYou can upload this CSV to Mailchimp, WhatsApp broadcast lists, SMS tools, or your email platform to run a win-back campaign.`
    );
  };

  const quickAction = (type: string) => {
    if (type === "graduates") {
      toast("Graduation campaign feature coming soon! This will create campaigns targeting recent customers for graduation framing.", "info");
    } else if (type === "reviews") {
      toast("Review request feature coming soon! This will send review requests to customers who completed jobs recently.", "info");
    } else if (type === "lapsed") {
      exportLapsedCustomersCSV();
    } else if (type === "artists") {
      toast("Artist outreach feature coming soon! This will help you reach out to artists and galleries.", "info");
    }
  };

  const copyReviewMessage = () => {
    const text = [
      "Hi! We hope you're enjoying your framed piece.",
      "If you have a moment, we'd really appreciate a quick review:",
      reviewLinks.google && `⭐ Google: ${reviewLinks.google}`,
      reviewLinks.facebook && `📘 Facebook: ${reviewLinks.facebook}`,
      reviewLinks.instagram && `📸 Instagram: ${reviewLinks.instagram}`,
    ]
      .filter(Boolean)
      .join("\n");

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        toast("Review message copied to clipboard!", "success");
      }).catch(() => {
        toast("Review message ready to copy", "info");
      });
    } else {
      toast("Review message ready to copy", "info");
    }
  };

  // Check for scheduled sends every minute
  useEffect(() => {
    const checkScheduledSends = () => {
      const now = new Date();
      const pending = scheduledSends.filter((s) => s.status === "pending");

      for (const send of pending) {
        const scheduledTime = new Date(send.scheduledFor);
        // Send if the scheduled time is in the past and within 1 minute
        if (scheduledTime <= now && (now.getTime() - scheduledTime.getTime()) < 60000) {
          const campaign = campaigns.find((c) => c.id === send.campaignId);
          if (campaign) {
            sendCampaignNow(campaign).then(() => {
              // Mark as sent
              const updated = scheduledSends.map((s) =>
                s.id === send.id ? { ...s, status: "sent" } : s
              );
              setScheduledSends(updated);
              localStorage.setItem("marketing.scheduled.sends.v1", JSON.stringify(updated));
            });
          }
        }
      }
    };

    const interval = setInterval(checkScheduledSends, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [scheduledSends, campaigns]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pb-6 border-b border-slate-200">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-1">📣 Marketing</h1>
          <p className="text-sm text-slate-600">
            Turn quotes, jobs, and customers into repeat business and referrals.
          </p>
        </div>
      </header>

      {/* UNDO BAR */}
      {canUndo() && (
        <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg mb-6">
          <span className="text-xs font-medium text-blue-900">Last action:</span>
          <button
            onClick={undo}
            className="px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded transition"
          >
            ↶ Undo
          </button>
        </div>
      )}

      {/* KPI tiles */}
      <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          label="Quotes this month"
          value={metrics.quotesThisMonth}
          sub="Top of funnel"
          icon="Target"
        />
        <MetricTile
          label="Jobs this month"
          value={metrics.jobsThisMonth}
          sub="Work booked in"
          icon="CheckCircle"
        />
        <MetricTile
          label="Quote → job conversion"
          value={metrics.conversion ? `${metrics.conversion}%` : "–"}
          sub="This month"
          icon="Zap"
        />
        <MetricTile
          label="Active customers (30d)"
          value={metrics.activeCustomers}
          sub="Recently engaged"
          icon="Users"
        />
      </section>

      {/* TIER 1: Revenue Impact Dashboard */}
      <section className="mb-6">
        <Card title="💰 Revenue impact & customer value" icon="Target">
          <p className="mb-4 text-xs text-slate-500">
            Understand where your revenue comes from and how fast you turn quotes into cash.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl ring-1 ring-emerald-200 bg-emerald-50 p-3">
              <div className="text-xs text-emerald-700">Total revenue (all-time)</div>
              <div className="mt-1 text-xl font-semibold text-emerald-900">
                ${metrics.totalRevenue.toFixed(0)}
              </div>
              <div className="mt-1 text-[11px] text-emerald-600">{metrics.totalJobs} jobs completed</div>
            </div>

            <div className="rounded-xl ring-1 ring-blue-200 bg-blue-50 p-3">
              <div className="text-xs text-blue-700">Revenue from repeat customers</div>
              <div className="mt-1 text-xl font-semibold text-blue-900">
                ${metrics.repeatRevenue.toFixed(0)}
              </div>
              <div className="mt-1 text-[11px] text-blue-600">{metrics.repeatCustomers} repeat customers</div>
            </div>

            <div className="rounded-xl ring-1 ring-purple-200 bg-purple-50 p-3">
              <div className="text-xs text-purple-700">Customer lifetime value</div>
              <div className="mt-1 text-xl font-semibold text-purple-900">
                ${metrics.repeatCustomerValue.toFixed(0)}
              </div>
              <div className="mt-1 text-[11px] text-purple-600">Per repeat customer</div>
            </div>

            <div className="rounded-xl ring-1 ring-orange-200 bg-orange-50 p-3">
              <div className="text-xs text-orange-700">Avg quote → job time</div>
              <div className="mt-1 text-xl font-semibold text-orange-900">
                {metrics.quoteToJobDays} days
              </div>
              <div className="mt-1 text-[11px] text-orange-600">Speed to conversion</div>
            </div>

            <div className="rounded-xl ring-1 ring-red-200 bg-red-50 p-3">
              <div className="text-xs text-red-700">Quote-to-job rate (all-time)</div>
              <div className="mt-1 text-xl font-semibold text-red-900">
                {metrics.quoteToJobPercent}%
              </div>
              <div className="mt-1 text-[11px] text-red-600">{metrics.totalQuotes} quotes total</div>
            </div>

            <div className="rounded-xl ring-1 ring-indigo-200 bg-indigo-50 p-3">
              <div className="text-xs text-indigo-700">Repeat rate (jobs → repeats)</div>
              <div className="mt-1 text-xl font-semibold text-indigo-900">
                {metrics.jobToRepeatPercent}%
              </div>
              <div className="mt-1 text-[11px] text-indigo-600">Of all jobs lead to repeats</div>
            </div>
          </div>

          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            <strong>Insight:</strong> Your repeat customers represent {metrics.totalRevenue > 0 ? Math.round((metrics.repeatRevenue / metrics.totalRevenue) * 100) : 0}% of revenue.
            Focus on converting more of your quotes into jobs, and turning those jobs into repeat business.
          </div>
        </Card>
      </section>

      {/* TIER 1: Conversion Funnel */}
      <section className="mb-6">
        <Card title="📊 Conversion funnel" icon="Zap">
          <p className="mb-4 text-xs text-slate-500">
            See where customers drop off and where you have the most opportunity to improve.
          </p>
          <div className="space-y-3">
            <FunnelStep
              label="Quotes"
              value={metrics.totalQuotes}
              percentage={100}
              color="bg-blue-100"
              borderColor="border-blue-300"
            />
            <FunnelStep
              label="Jobs (from quotes)"
              value={metrics.totalJobs}
              percentage={metrics.quoteToJobPercent}
              color="bg-emerald-100"
              borderColor="border-emerald-300"
              dropoff={metrics.totalQuotes - metrics.totalJobs}
            />
            <FunnelStep
              label="Repeat customers (from jobs)"
              value={metrics.repeatCustomers}
              percentage={metrics.jobToRepeatPercent}
              color="bg-purple-100"
              borderColor="border-purple-300"
              dropoff={metrics.totalJobs - metrics.repeatCustomers}
            />
          </div>

          <div className="mt-4 text-xs text-slate-600 space-y-1">
            <p>
              <strong>Quote leakage:</strong> {metrics.totalQuotes - metrics.totalJobs} quotes didn't convert to jobs
              ({100 - metrics.quoteToJobPercent}% drop-off). Consider follow-ups and discount strategies.
            </p>
            <p>
              <strong>Repeat opportunity:</strong> {metrics.totalJobs - metrics.repeatCustomers} job customers didn't return
              ({100 - metrics.jobToRepeatPercent}% drop-off). Build referral incentives and loyalty programs.
            </p>
          </div>
        </Card>
      </section>

      {/* TIER 1: Smart Campaign Automation */}
      <section className="mb-6">
        <Card title="🤖 Smart campaign automation" icon="Megaphone">
          <p className="mb-4 text-xs text-slate-500">
            Create and manage custom campaigns that keep customers engaged.
          </p>

          {/* Automation Settings Panel - NOW AT TOP */}
          <div className="mb-4 rounded-lg border-2 border-blue-200 bg-blue-50 p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-semibold text-blue-900">⚡ Automation Settings</div>
                <div className="text-xs text-blue-700">Send campaigns automatically via API integrations</div>
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={automationSettings.enabled}
                  onChange={(e) =>
                    saveAutomationSettings({
                      ...automationSettings,
                      enabled: e.target.checked,
                    })
                  }
                  className="w-4 h-4 rounded"
                />
                <span className="text-xs font-semibold text-blue-900">
                  {automationSettings.enabled ? "✓ Enabled" : "Disabled"}
                </span>
              </label>
            </div>

            {automationSettings.enabled ? (
              <div className="mt-3 text-xs text-blue-800">
                ✓ Automation is active. Create campaigns above to send via Email, WhatsApp, or Mailchimp.
                <a
                  href="https://github.com/yourusername/framing-app/blob/main/AUTOMATION_SETUP.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 underline hover:text-blue-900"
                >
                  View setup guide
                </a>
              </div>
            ) : (
              <div className="mt-3 text-xs text-blue-700">
                Enable automation to send campaigns automatically via Email, WhatsApp, or Mailchimp. Configure API keys first.
                <a
                  href="https://github.com/yourusername/framing-app/blob/main/AUTOMATION_SETUP.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 underline hover:text-blue-800"
                >
                  Setup guide
                </a>
              </div>
            )}
          </div>

          {/* Campaigns List */}
          <div className="mt-6 space-y-3">
            {campaigns.length === 0 ? (
              <div className="text-center py-6 rounded-lg bg-slate-50">
                <div className="text-sm text-slate-500">No campaigns yet</div>
                <div className="text-xs text-slate-400 mt-1">Create your first campaign to get started</div>
              </div>
            ) : (
              campaigns.map((campaign) => (
                <div
                  key={campaign.id}
                  className="rounded-lg border-l-4 border-blue-500 bg-blue-50 p-4 flex items-start justify-between"
                >
                  <div className="flex-1">
                    <div className="font-semibold text-slate-900">{campaign.name}</div>
                    <div className="text-xs text-slate-600 mt-1">{campaign.description}</div>
                    <div className="flex gap-3 mt-2 text-xs">
                      <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded">
                        📊 {campaign.targetAudience === "recent"
                          ? "Recent jobs"
                          : campaign.targetAudience === "pending-quotes"
                          ? "Pending quotes"
                          : campaign.targetAudience === "repeat"
                          ? "Repeat customers"
                          : campaign.targetAudience === "lapsed"
                          ? "Lapsed customers"
                          : campaign.targetAudience === "all"
                          ? "All customers"
                          : "Custom selection"}
                      </span>
                      <span className="px-2 py-1 bg-slate-200 text-slate-700 rounded">
                        {campaign.channel === "whatsapp"
                          ? "💬 WhatsApp"
                          : campaign.channel === "email"
                          ? "📧 Email"
                          : "📬 Mailchimp"}
                      </span>
                      <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded">
                        👥 {getRecipientCount(campaign.targetAudience, campaign.customCustomerIds)} recipients
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4 flex-col">
                    <button
                      onClick={() => setupCampaign(campaign)}
                      className="px-3 py-1.5 text-xs font-semibold rounded bg-amber-500 text-white hover:bg-amber-600 transition whitespace-nowrap"
                    >
                      ✏️ Edit
                    </button>
                    <button
                      onClick={() => sendCampaignNow(campaign)}
                      className="px-3 py-1.5 text-xs font-semibold rounded bg-blue-600 text-white hover:bg-blue-700 transition whitespace-nowrap"
                    >
                      📤 Send Now
                    </button>
                    <button
                      onClick={() => setSchedulingCampaignId(campaign.id)}
                      className="px-3 py-1.5 text-xs font-semibold rounded bg-indigo-600 text-white hover:bg-indigo-700 transition whitespace-nowrap"
                    >
                      ⏰ Send Later
                    </button>
                    <button
                      onClick={() => {
                        deleteCampaign(campaign.id);
                        toast(`Campaign "${campaign.name}" deleted`, "success");
                      }}
                      className="px-3 py-1.5 text-xs font-semibold rounded bg-red-500 text-white hover:bg-red-600 transition whitespace-nowrap"
                    >
                      🗑 Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Edit Campaign Form */}
          {editingCampaign && (
            <div className="mt-4 rounded-lg border-2 border-amber-200 bg-amber-50 p-4 space-y-3">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold text-amber-900">✏️ Edit Campaign</div>
                <button
                  onClick={() => setEditingCampaign(null)}
                  className="text-amber-600 hover:text-amber-900 text-lg"
                >
                  ✕
                </button>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Campaign Name
                </label>
                <input
                  type="text"
                  value={editingCampaign.name}
                  onChange={(e) => updateEditingCampaign({ name: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={editingCampaign.description}
                  onChange={(e) => updateEditingCampaign({ description: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Target Audience
                </label>
                <select
                  value={editingCampaign.targetAudience}
                  onChange={(e) => {
                    updateEditingCampaign({ targetAudience: e.target.value });
                    if (e.target.value === "custom" && !editingCampaign.customCustomerIds) {
                      updateEditingCampaign({ customCustomerIds: [] });
                    }
                  }}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="all">All customers</option>
                  <option value="recent">Recent jobs (last 7 days)</option>
                  <option value="pending-quotes">Pending quotes (7-30 days)</option>
                  <option value="repeat">Repeat customers</option>
                  <option value="lapsed">Lapsed customers (6+ months)</option>
                  <option value="custom">Custom selection...</option>
                </select>
              </div>

              {/* Customer Multi-Select for Edit Custom Audience */}
              {editingCampaign.targetAudience === "custom" && (
                <div className="bg-white rounded-lg border border-slate-300 p-3 max-h-64 overflow-y-auto">
                  <div className="text-xs font-semibold text-slate-700 mb-2">
                    Select Customers ({(editingCampaign.customCustomerIds || []).length} selected)
                  </div>
                  <div className="space-y-1">
                    {customers.map((customer) => (
                      <label key={customer.id} className="flex items-center gap-2 hover:bg-slate-50 p-1 rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={(editingCampaign.customCustomerIds || []).includes(customer.id || "")}
                          onChange={(e) => {
                            const currentIds = editingCampaign.customCustomerIds || [];
                            if (e.target.checked) {
                              updateEditingCampaign({ customCustomerIds: [...currentIds, customer.id || ""] });
                            } else {
                              updateEditingCampaign({ customCustomerIds: currentIds.filter((id) => id !== customer.id) });
                            }
                          }}
                          className="w-4 h-4"
                        />
                        <span className="text-xs flex-1">
                          {`${customer.firstName || ""} ${customer.lastName || ""}`.trim() || customer.company || "Unnamed"} {customer.email && `(${customer.email})`}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Channel
                </label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="editChannel"
                      value="email"
                      checked={editingCampaign.channel === "email"}
                      onChange={(e) => updateEditingCampaign({ channel: e.target.value as any })}
                      className="w-4 h-4"
                    />
                    <span className="text-xs">📧 Email</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="editChannel"
                      value="whatsapp"
                      checked={editingCampaign.channel === "whatsapp"}
                      onChange={(e) => updateEditingCampaign({ channel: e.target.value as any })}
                      className="w-4 h-4"
                    />
                    <span className="text-xs">💬 WhatsApp</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="editChannel"
                      value="mailchimp"
                      checked={editingCampaign.channel === "mailchimp"}
                      onChange={(e) => updateEditingCampaign({ channel: e.target.value as any })}
                      className="w-4 h-4"
                    />
                    <span className="text-xs">📬 Mailchimp</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Message Template
                </label>
                <textarea
                  value={editingCampaign.messageTemplate}
                  onChange={(e) => updateEditingCampaign({ messageTemplate: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={saveEditingCampaign}
                  className="flex-1 px-4 py-2 text-xs font-semibold rounded bg-amber-600 text-white hover:bg-amber-700 transition"
                >
                  ✓ Save Changes
                </button>
                <button
                  onClick={() => setEditingCampaign(null)}
                  className="flex-1 px-4 py-2 text-xs font-semibold rounded bg-slate-300 text-slate-700 hover:bg-slate-400 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Send Later Scheduler */}
          {schedulingCampaignId && (
            <div className="mt-4 rounded-lg border-2 border-indigo-200 bg-indigo-50 p-4 space-y-3">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold text-indigo-900">⏰ Schedule Send</div>
                <button
                  onClick={() => setSchedulingCampaignId(null)}
                  className="text-indigo-600 hover:text-indigo-900 text-lg"
                >
                  ✕
                </button>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Send Date
                </label>
                <input
                  type="date"
                  id="scheduleDate"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Send Time
                </label>
                <input
                  type="time"
                  id="scheduleTime"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="bg-indigo-100 rounded p-2 text-xs text-indigo-800">
                ℹ️ Campaign will be sent automatically at the scheduled time
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => {
                    const date = (document.getElementById("scheduleDate") as HTMLInputElement)?.value;
                    const time = (document.getElementById("scheduleTime") as HTMLInputElement)?.value;
                    if (!date || !time) {
                      toast("Please select both date and time", "error");
                      return;
                    }
                    const sendDateTime = `${date}T${time}`;
                    scheduleCampaignSend(schedulingCampaignId!, sendDateTime);
                  }}
                  className="flex-1 px-4 py-2 text-xs font-semibold rounded bg-indigo-600 text-white hover:bg-indigo-700 transition"
                >
                  ✓ Schedule
                </button>
                <button
                  onClick={() => setSchedulingCampaignId(null)}
                  className="flex-1 px-4 py-2 text-xs font-semibold rounded bg-slate-300 text-slate-700 hover:bg-slate-400 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Scheduled Sends Display */}
          {scheduledSends.length > 0 && (
            <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 p-4">
              <div className="text-xs font-semibold text-indigo-900 mb-2">⏱️ Scheduled Sends</div>
              <div className="space-y-2">
                {scheduledSends.map((send) => (
                  <div key={send.id} className="flex items-center justify-between bg-white rounded p-2 text-xs">
                    <div>
                      <div className="font-semibold text-slate-900">{send.campaignName}</div>
                      <div className="text-slate-600">
                        Scheduled for {new Date(send.scheduledFor).toLocaleString()}
                      </div>
                    </div>
                    <button
                      onClick={() => cancelScheduledSend(send.id)}
                      className="px-2 py-1 text-xs font-semibold rounded bg-red-100 text-red-600 hover:bg-red-200"
                    >
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => setShowNewCampaignForm(!showNewCampaignForm)}
            className="mt-4 w-full px-4 py-2.5 text-sm font-semibold rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700 transition"
          >
            {showNewCampaignForm ? "✕ Cancel" : "+ Add Campaign"}
          </button>

          {/* New Campaign Form */}
          {showNewCampaignForm && (
            <div className="mt-4 rounded-lg border-2 border-slate-200 bg-slate-50 p-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Campaign Name *
                </label>
                <input
                  type="text"
                  id="campaignName"
                  placeholder="e.g., Holiday Special, Graduation Season, Spring Promo"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  id="campaignDescription"
                  placeholder="What's the goal of this campaign?"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Target Audience *
                </label>
                <select
                  id="targetAudience"
                  onChange={(e) => {
                    if (e.target.value === "custom") {
                      setSelectedCustomerIds([]);
                    }
                  }}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All customers</option>
                  <option value="recent">Recent jobs (last 7 days)</option>
                  <option value="pending-quotes">Pending quotes (7-30 days)</option>
                  <option value="repeat">Repeat customers</option>
                  <option value="lapsed">Lapsed customers (6+ months)</option>
                  <option value="custom">Custom selection...</option>
                </select>
              </div>

              {/* Customer Multi-Select for Custom Audience */}
              {(document.getElementById("targetAudience") as HTMLSelectElement)?.value === "custom" && (
                <div className="bg-white rounded-lg border border-slate-300 p-3 max-h-64 overflow-y-auto">
                  <div className="text-xs font-semibold text-slate-700 mb-2">
                    Select Customers ({selectedCustomerIds.length} selected)
                  </div>
                  <div className="space-y-1">
                    {customers.map((customer) => (
                      <label key={customer.id} className="flex items-center gap-2 hover:bg-slate-50 p-1 rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedCustomerIds.includes(customer.id || "")}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedCustomerIds([...selectedCustomerIds, customer.id || ""]);
                            } else {
                              setSelectedCustomerIds(selectedCustomerIds.filter((id) => id !== customer.id));
                            }
                          }}
                          className="w-4 h-4"
                        />
                        <span className="text-xs flex-1">
                          {`${customer.firstName || ""} ${customer.lastName || ""}`.trim() || customer.company || "Unnamed"} {customer.email && `(${customer.email})`}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Channel *
                </label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <input type="radio" name="newChannel" value="email" defaultChecked className="w-4 h-4" />
                    <span className="text-xs">📧 Email</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="newChannel" value="whatsapp" className="w-4 h-4" />
                    <span className="text-xs">💬 WhatsApp</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="newChannel" value="mailchimp" className="w-4 h-4" />
                    <span className="text-xs">📬 Mailchimp</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Message Template *
                </label>
                <textarea
                  id="messageTemplate"
                  placeholder="Craft your campaign message here..."
                  rows={3}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => {
                    const name = (document.getElementById("campaignName") as HTMLInputElement)?.value || "";
                    const description = (document.getElementById("campaignDescription") as HTMLInputElement)?.value || "";
                    const audience = (document.getElementById("targetAudience") as HTMLSelectElement)?.value || "recent";
                    const channel = (document.querySelector('input[name="newChannel"]:checked') as HTMLInputElement)?.value || "email";
                    const template = (document.getElementById("messageTemplate") as HTMLTextAreaElement)?.value || "";

                    if (!name.trim() || !template.trim()) {
                      toast("Please fill in campaign name and message", "error");
                      return;
                    }

                    if (audience === "custom" && selectedCustomerIds.length === 0) {
                      toast("Please select at least one customer for custom audience", "error");
                      return;
                    }

                    addCampaign({
                      name,
                      description,
                      targetAudience: audience,
                      channel: channel as "email" | "whatsapp" | "mailchimp",
                      messageTemplate: template,
                      customCustomerIds: audience === "custom" ? selectedCustomerIds : undefined,
                      enabled: true,
                    });

                    // Reset form
                    (document.getElementById("campaignName") as HTMLInputElement).value = "";
                    (document.getElementById("campaignDescription") as HTMLInputElement).value = "";
                    (document.getElementById("messageTemplate") as HTMLTextAreaElement).value = "";
                    setSelectedCustomerIds([]);
                    setShowNewCampaignForm(false);
                  }}
                  className="flex-1 px-4 py-2 text-xs font-semibold rounded bg-blue-600 text-white hover:bg-blue-700 transition"
                >
                  ✓ Create Campaign
                </button>
                <button
                  onClick={() => setShowNewCampaignForm(false)}
                  className="flex-1 px-4 py-2 text-xs font-semibold rounded bg-slate-300 text-slate-700 hover:bg-slate-400 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Card>
      </section>

      {/* TIER 1: Communication Templates Library */}
      <section className="mb-8">
        <Card title="💌 Communication templates library" icon="MessageSquare">
          <p className="mb-4 text-xs text-slate-500">
            Pre-written messages you can copy-paste into WhatsApp, email, or SMS. Personalize with customer names. Add, edit, or remove templates as needed.
          </p>

          {/* Add New Template */}
          <div className="mb-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
            <div className="text-xs font-semibold text-slate-700 mb-2">➕ Add custom template</div>
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Template name (e.g., Birthday Follow-up)"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                className="w-full text-xs rounded border border-slate-300 px-2 py-1"
              />
              <textarea
                placeholder="Template content (use [brackets] for personalization)"
                value={newTemplateContent}
                onChange={(e) => setNewTemplateContent(e.target.value)}
                className="w-full text-xs rounded border border-slate-300 px-2 py-1 font-mono"
                rows={2}
              />
              <div className="flex gap-2">
                <select
                  value={newTemplateCategory}
                  onChange={(e) => setNewTemplateCategory(e.target.value)}
                  className="text-xs rounded border border-slate-300 px-2 py-1"
                >
                  <option>Quote Follow-up</option>
                  <option>Reviews</option>
                  <option>Repeat Customers</option>
                  <option>Referrals</option>
                  <option>Custom</option>
                </select>
                <button
                  onClick={addTemplate}
                  className="text-xs rounded px-3 py-1 bg-blue-600 text-white hover:bg-blue-700 font-semibold"
                >
                  Add Template
                </button>
              </div>
            </div>
          </div>

          {/* Template List */}
          <div className="space-y-3">
            {templates.map((template) => (
              <div
                key={template.id}
                className={`rounded-lg border p-3 ${
                  template.color === "green"
                    ? "border-green-200 bg-green-50"
                    : template.color === "blue"
                    ? "border-blue-200 bg-blue-50"
                    : template.color === "purple"
                    ? "border-purple-200 bg-purple-50"
                    : "border-slate-200"
                }`}
              >
                {editingId === template.id ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={template.name}
                      onChange={(e) =>
                        updateTemplate(template.id, { name: e.target.value })
                      }
                      className="w-full text-sm font-semibold rounded border border-slate-300 px-2 py-1"
                    />
                    <textarea
                      value={template.content}
                      onChange={(e) =>
                        updateTemplate(template.id, { content: e.target.value })
                      }
                      className="w-full text-xs rounded border border-slate-300 px-2 py-1 font-mono"
                      rows={2}
                    />
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-xs rounded px-2 py-1 bg-slate-900 text-white hover:bg-slate-800"
                    >
                      Done
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div
                          className={`text-sm font-semibold ${
                            template.color === "green"
                              ? "text-green-900"
                              : template.color === "blue"
                              ? "text-blue-900"
                              : template.color === "purple"
                              ? "text-purple-900"
                              : "text-slate-900"
                          }`}
                        >
                          {template.name}
                        </div>
                        <div
                          className={`text-xs ${
                            template.color === "green"
                              ? "text-green-700"
                              : template.color === "blue"
                              ? "text-blue-700"
                              : template.color === "purple"
                              ? "text-purple-700"
                              : "text-slate-600"
                          }`}
                        >
                          {template.category}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setEditingId(template.id)}
                          className="text-xs rounded px-2 py-1 bg-slate-200 text-slate-700 hover:bg-slate-300"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteTemplate(template.id)}
                          className="text-xs rounded px-2 py-1 bg-red-100 text-red-700 hover:bg-red-200"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    <div
                      className={`text-xs font-mono p-2 rounded mb-2 ${
                        template.color === "green"
                          ? "bg-white text-green-900"
                          : template.color === "blue"
                          ? "bg-white text-blue-900"
                          : template.color === "purple"
                          ? "bg-white text-purple-900"
                          : "bg-slate-50 text-slate-700"
                      }`}
                    >
                      {template.content}
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      <button
                        onClick={() => copyToClipboard(template.content, template.id)}
                        className={`text-xs rounded px-3 py-1 font-semibold transition-colors ${
                          copiedId === template.id
                            ? "bg-green-600 text-white"
                            : "bg-slate-900 text-white hover:bg-slate-800"
                        }`}
                      >
                        {copiedId === template.id ? "✓ Copied!" : "Copy"}
                      </button>
                      <button
                        onClick={() => openTemplateSender(template.id, "email")}
                        className="text-xs rounded px-3 py-1 bg-blue-500 text-white hover:bg-blue-600 font-semibold transition"
                      >
                        📧 Send Email
                      </button>
                      <button
                        onClick={() => openTemplateSender(template.id, "whatsapp")}
                        className="text-xs rounded px-3 py-1 bg-green-500 text-white hover:bg-green-600 font-semibold transition"
                      >
                        💬 Send WhatsApp
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            <strong>Pro tip:</strong> Personalize [bracketed] sections with customer names and items. Use [Name], [item], [date], etc.
          </div>
        </Card>
      </section>

      {/* Template Sender Modal */}
      {sendingTemplateId && sendingChannel && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full max-h-screen overflow-y-auto">
            <div className="p-4 border-b sticky top-0 bg-white">
              <h2 className="text-lg font-semibold">
                Send via {sendingChannel === "email" ? "📧 Email" : "💬 WhatsApp"}
              </h2>
            </div>

            <div className="p-4 space-y-4">
              {/* Recipient Selection */}
              <div>
                <label className="block text-sm font-semibold mb-2">Select Recipients</label>
                <div className="border rounded-lg p-3 max-h-64 overflow-y-auto space-y-2">
                  {customers.length === 0 ? (
                    <p className="text-xs text-slate-500">No customers available</p>
                  ) : (
                    customers.map((customer) => (
                      <label key={customer.id} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={sendingRecipients.includes(customer.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSendingRecipients([...sendingRecipients, customer.id]);
                            } else {
                              setSendingRecipients(sendingRecipients.filter((id) => id !== customer.id));
                            }
                          }}
                          className="rounded"
                        />
                        <span className="text-xs">
                          {customer.firstName} {customer.lastName} ({customer.email || "no email"})
                        </span>
                      </label>
                    ))
                  )}
                </div>
                <p className="text-xs text-slate-600 mt-2">{sendingRecipients.length} selected</p>
              </div>

              {/* Message Preview */}
              <div>
                <label className="block text-sm font-semibold mb-2">Message Preview</label>
                <textarea
                  value={sendingContent}
                  onChange={(e) => setSendingContent(e.target.value)}
                  className="w-full text-xs rounded border px-3 py-2 font-mono"
                  rows={4}
                />
                <p className="text-xs text-slate-600 mt-1">
                  You can personalize [Name], [Company], etc. before sending
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 justify-end">
                <button
                  onClick={closeTemplateSender}
                  className="text-xs rounded px-4 py-2 border border-slate-300 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={sendTemplate}
                  className="text-xs rounded px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 font-semibold"
                >
                  Send to {sendingRecipients.length} {sendingRecipients.length === 1 ? "recipient" : "recipients"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Template Send History */}
      <section className="mb-8">
        <Card title="📊 Template Send History" icon="MessageSquare">
          <p className="mb-4 text-xs text-slate-500">
            Log of all template sends. Track which customers received which templates and when.
          </p>

          {templateSends.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">No template sends yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-slate-50">
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">Template</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">Recipient</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">Channel</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">Status</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">Sent</th>
                  </tr>
                </thead>
                <tbody>
                  {templateSends.slice(0, 20).map((send) => (
                    <tr key={send.id} className="border-b hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-900">{send.templateName}</td>
                      <td className="px-3 py-2">
                        <div className="text-slate-900">{send.recipientName}</div>
                        <div className="text-slate-500">{send.recipientEmail}</div>
                      </td>
                      <td className="px-3 py-2">
                        {send.channel === "email" ? "📧 Email" : "💬 WhatsApp"}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex px-2 py-1 rounded text-[11px] font-semibold ${
                            send.status === "sent"
                              ? "bg-green-100 text-green-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {send.status === "sent" ? "✓ Sent" : "✗ Failed"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {new Date(send.timestamp).toLocaleDateString()} at{" "}
                        {new Date(send.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {templateSends.length > 20 && (
                <p className="text-xs text-slate-500 mt-2">Showing latest 20 of {templateSends.length} sends</p>
              )}
            </div>
          )}
        </Card>
      </section>
    </main>
  );
}

/* --- Small subcomponents --- */

function MetricTile({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: keyof typeof Icon;
}) {
  const Ico = Icon[icon];
  return (
    <div className="flex items-start justify-between rounded-2xl border border-slate-100 bg-white px-3 py-3 text-sm shadow-sm">
      <div>
        <div className="text-xs font-medium text-slate-500">{label}</div>
        <div className="mt-1 text-lg font-semibold">{value}</div>
        {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
      </div>
      <Ico width={20} height={20} className="text-slate-400" />
    </div>
  );
}

function QuickAction({
  title,
  description,
  emphasis,
  onClick,
}: {
  title: string;
  description: string;
  emphasis: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left text-xs hover:bg-slate-900 hover:text-white transition-colors"
    >
      <div className="font-semibold">{title}</div>
      <div className="mt-1 text-[11px] opacity-90">{description}</div>
      <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-medium text-slate-700">
        <Icon.Zap width={12} height={12} />
        <span>{emphasis}</span>
      </div>
    </button>
  );
}

function FunnelStep({
  label,
  value,
  percentage,
  color,
  borderColor,
  dropoff,
}: {
  label: string;
  value: number;
  percentage: number;
  color: string;
  borderColor: string;
  dropoff?: number;
}) {
  const maxWidth = Math.max(percentage, 20);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs font-semibold text-slate-700">{label}</div>
        <div className="text-xs font-semibold text-slate-700">
          {value} ({percentage}%)
        </div>
      </div>
      <div className={`rounded-lg ${borderColor} border-2 overflow-hidden`}>
        <div
          className={`${color} h-8 transition-all`}
          style={{ width: `${maxWidth}%` }}
        />
      </div>
      {dropoff !== undefined && dropoff > 0 && (
        <div className="mt-1 text-[11px] text-red-600">
          ↓ {dropoff} dropped off ({Math.round((dropoff / (value + dropoff)) * 100)}%)
        </div>
      )}
    </div>
  );
}

function AutomationItem({
  title,
  description,
  action,
  color,
  onClick,
}: {
  title: string;
  description: string;
  action: string;
  color: string;
  onClick?: () => void;
}) {
  return (
    <div className={`rounded-lg border p-3 ${color}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <div className="mt-1 text-xs opacity-85">{description}</div>
        </div>
        <button 
          onClick={onClick}
          className="px-2 py-1 text-[11px] font-medium rounded bg-white/50 hover:bg-white transition whitespace-nowrap"
        >
          {action}
        </button>
      </div>
    </div>
  );
}

function SegmentRow({
  label,
  value,
  idea,
}: {
  label: string;
  value: number;
  idea: string;
}) {
  return (
    <div className="flex items-start justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-xs">
      <div>
        <div className="font-medium text-slate-800">{label}</div>
        <div className="mt-0.5 text-[11px] text-slate-500">{idea}</div>
      </div>
      <div className="ml-3 flex h-8 w-8 items-center justify-center rounded-full bg-white text-sm font-semibold text-slate-800">
        {value}
      </div>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-slate-600">{label}</span>
      <input
        className="rounded border px-2 py-1 text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

/* --- Helpers --- */

function rid() {
  return Math.random().toString(36).slice(2, 8);
}

function nextMonthIso(): string {
  const d = new Date();
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return next.toISOString().slice(0, 10);
}

function csvEscape(value: any): string {
  const s = value == null ? "" : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
