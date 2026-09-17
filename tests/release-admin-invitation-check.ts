import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const handlerUrl = 'http://127.0.0.1:55401/api/admin/users'
const appUrl = 'http://127.0.0.1:55400'
const inboxUrl = 'http://127.0.0.1:55324'
const service = createClient(url, serviceKey)
const suffix = Date.now().toString(36)
const ownerEmail = `release-owner-${suffix}@test.local`
const memberEmail = `release-member-${suffix}@test.local`
const inviteeEmail = `release-invitee-${suffix}@test.local`
const otherEmail = `release-other-${suffix}@test.local`
const password = 'LocalReleasePass!234'
const fail = (message: string): never => { throw new Error(message) }

async function createUser(email: string) { const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true }); if (error || !data.user) fail(error?.message || 'Could not create user'); return data.user }
async function signIn(email: string, label: string) { const client = createClient(url, process.env.SUPABASE_ANON_KEY!); const { data, error } = await client.auth.signInWithPassword({ email, password }); if (error || !data.session) fail(`${label}: ${error?.message || 'Could not sign in'}`); return { client, token: data.session.access_token } }
async function request(token: string, method: string, body?: unknown) { const response = await fetch(handlerUrl, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-forwarded-proto': 'http', 'x-forwarded-host': '127.0.0.1:55400' }, body: body ? JSON.stringify(body) : undefined }); const raw = await response.text(); try { return { status: response.status, body: JSON.parse(raw) } } catch { fail(`Handler ${method} returned ${response.status}: ${raw}`) } }

try {
  const owner = await createUser(ownerEmail); const other = await createUser(otherEmail); const staff = await createUser(memberEmail)
  const ownerAuth = await signIn(ownerEmail, 'owner sign-in'); const otherAuth = await signIn(otherEmail, 'unrelated sign-in'); const staffAuth = await signIn(memberEmail, 'staff sign-in')
  const { data: company, error: companyError } = await ownerAuth.client.rpc('create_company_trial_account', { p_company_name: `Release Invite ${suffix}` }).single(); if (companyError || !company) fail(companyError?.message || 'Could not create company')
  await service.from('company_accounts').update({ plan_status: 'active' }).eq('id', company.id)
  const { data: otherCompany, error: otherCompanyError } = await otherAuth.client.rpc('create_company_trial_account', { p_company_name: `Other ${suffix}` }).single(); if (otherCompanyError || !otherCompany) fail(otherCompanyError?.message || 'Could not create other company')
  await service.from('company_accounts').update({ plan_status: 'active' }).eq('id', otherCompany.id)
  const { error: staffInsertError } = await service.from('company_members').insert({ company_account_id: company.id, user_id: staff.id, email: memberEmail, role: 'staff', status: 'active', joined_at: new Date().toISOString() }); if (staffInsertError) fail(staffInsertError.message)
  const invite = await request(ownerAuth.token, 'POST', { email: inviteeEmail, fullName: 'Invited Staff', role: 'staff' }); if (invite.status !== 200 || invite.body.member?.status !== 'invited') fail(`Invite failed: ${invite.status} ${JSON.stringify(invite.body)}`)
  const inbox = await (await fetch(`${inboxUrl}/api/v1/messages`)).json() as { messages?: any[] }
  const message = inbox.messages?.find(item => JSON.stringify(item).includes(inviteeEmail)); if (!message) fail('Invitation missing from local mail inbox')
  const messageDetail = await (await fetch(`${inboxUrl}/api/v1/message/${message.ID}`)).json() as { Text?: string; HTML?: string }
  const rawMessage = `${messageDetail.Text || ''}\n${messageDetail.HTML || ''}`
  const link = rawMessage.match(/https?:[^\s"<]+\/auth\/v1\/verify[^\s"<]+/)?.[0]?.replace(/&amp;/g, '&'); if (!link) fail('Confirmation link missing from invitation')
  const confirmation = await fetch(link, { redirect: 'manual' }); const redirect = confirmation.headers.get('location') || ''; if (!redirect.startsWith(`${appUrl}/auth/callback`)) fail(`Callback was not isolated local app: ${redirect}`)
  const callbackUrl = new URL(redirect); const confirmedClient = createClient(url, process.env.SUPABASE_ANON_KEY!); const code = callbackUrl.searchParams.get('code');
  if (code) { const { error: exchangeError } = await confirmedClient.auth.exchangeCodeForSession(code); if (exchangeError) fail(exchangeError.message) } else { const callbackSession = new URLSearchParams(callbackUrl.hash.slice(1)); const accessToken = callbackSession.get('access_token'); const refreshToken = callbackSession.get('refresh_token'); if (!accessToken || !refreshToken) fail(`Confirmation callback did not include an invite session (path=${callbackUrl.pathname}, query=${[...callbackUrl.searchParams.keys()].join(',')}, hash=${[...callbackSession.keys()].join(',')})`); const { error: setSessionError } = await confirmedClient.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }); if (setSessionError) fail(setSessionError.message) }
  const { error: passwordError } = await confirmedClient.auth.updateUser({ password }); if (passwordError) fail(passwordError.message)
  const invitee = await signIn(inviteeEmail, 'invitee sign-in'); const { data: accepted, error: acceptError } = await invitee.client.rpc('accept_company_invitation').single(); if (acceptError || !accepted || accepted.company_account_id !== company.id || accepted.role !== 'staff' || accepted.status !== 'active') fail(acceptError?.message || 'Invitation acceptance failed')
  const { data: ownedAfter } = await service.from('company_accounts').select('id').eq('owner_user_id', accepted.user_id).maybeSingle(); if (ownedAfter) fail('Invitation created an extra company')
  const staffDenied = await request(staffAuth.token, 'POST', { email: `denied-${suffix}@test.local`, role: 'staff' }); if (staffDenied.status !== 400 || !String(staffDenied.body.error).includes('admin access')) fail('Ordinary staff invitation was not denied')
  const otherDenied = await request(otherAuth.token, 'PATCH', { memberId: invite.body.member.id, status: 'inactive' }); if (otherDenied.status !== 400 || !String(otherDenied.body.error).includes('Member not found')) fail('Unrelated company user managed target membership')
  const revoked = await request(ownerAuth.token, 'PATCH', { memberId: invite.body.member.id, status: 'inactive' }); if (revoked.status !== 200) fail('Could not revoke invitation')
  const { error: secondAccept } = await invitee.client.rpc('accept_company_invitation').single(); if (!secondAccept) fail('Revoked invitation restored membership')
  const invalid = await request(ownerAuth.token, 'POST', { email: '', role: 'staff' }); if (invalid.status !== 400 || String(invalid.body.error).includes('sent')) fail('Invitation failure reported as sent')
  console.log('RELEASE_ADMIN_INVITATION_HTTP_PASS')
} catch (error) { console.error(error); process.exitCode = 1 }
