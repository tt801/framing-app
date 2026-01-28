// src/lib/automationLogs.ts
// Helper functions for tracking marketing automation activity

export interface AutomationLog {
  id: string;
  timestamp: string;
  type: 'review-request' | 'quote-followup';
  channel: 'whatsapp' | 'email' | 'mailchimp';
  customerName: string;
  customerContact: string;
  status: 'sent' | 'failed';
  error?: string;
}

const STORAGE_KEY = 'marketing.automation.logs.v1';
const MAX_LOGS = 500; // Keep last 500 logs

export function logAutomation(log: Omit<AutomationLog, 'id' | 'timestamp'>): void {
  try {
    const logs = getAutomationLogs();
    
    const newLog: AutomationLog = {
      ...log,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
    };

    // Add to beginning and limit size
    const updated = [newLog, ...logs].slice(0, MAX_LOGS);
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error('Failed to log automation:', error);
  }
}

export function getAutomationLogs(): AutomationLog[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Failed to get automation logs:', error);
    return [];
  }
}

export function getLogStats() {
  const logs = getAutomationLogs();
  
  const total = logs.length;
  const sent = logs.filter(l => l.status === 'sent').length;
  const failed = logs.filter(l => l.status === 'failed').length;
  const reviewRequests = logs.filter(l => l.type === 'review-request').length;
  const quoteFollowups = logs.filter(l => l.type === 'quote-followup').length;
  
  const byChannel = {
    whatsapp: logs.filter(l => l.channel === 'whatsapp').length,
    email: logs.filter(l => l.channel === 'email').length,
    mailchimp: logs.filter(l => l.channel === 'mailchimp').length,
  };

  const last24Hours = logs.filter(l => {
    const logDate = new Date(l.timestamp);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return logDate >= yesterday;
  }).length;

  return {
    total,
    sent,
    failed,
    reviewRequests,
    quoteFollowups,
    byChannel,
    last24Hours,
    successRate: total > 0 ? Math.round((sent / total) * 100) : 0,
  };
}

export function clearAutomationLogs(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function exportLogsToCSV(): string {
  const logs = getAutomationLogs();
  
  const headers = ['Timestamp', 'Type', 'Channel', 'Customer', 'Contact', 'Status', 'Error'];
  const rows = logs.map(log => [
    new Date(log.timestamp).toLocaleString(),
    log.type,
    log.channel,
    log.customerName,
    log.customerContact,
    log.status,
    log.error || '',
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
  ].join('\n');

  return csvContent;
}

export function downloadLogsCSV(): void {
  const csv = exportLogsToCSV();
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `automation-logs-${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
