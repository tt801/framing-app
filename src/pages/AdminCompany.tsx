// src/pages/AdminCompany.tsx
import React from 'react'
import { useCompany } from '../lib/company'
import { useCatalog } from '../lib/store'

export default function AdminCompany() {
  const { profile, save, reset } = useCompany()
  const { catalog: _catalog } = useCatalog()

  const onChange =
    (key: keyof typeof profile) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      save({ [key]: e.target.value })

  return (
    <section className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base sm:text-lg font-semibold">Company Setup</h2>
        <div className="flex gap-2">
          <button
            onClick={reset}
            className="rounded-lg border px-3 py-2 text-sm"
            title="Reset to defaults"
          >
            Reset
          </button>
          <button
            onClick={() => alert('Saved')}
            className="rounded-lg bg-neutral-900 text-white px-3 py-2 text-sm"
          >
            Save
          </button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Identity */}
        <div className="space-y-3">
          <h3 className="font-medium">Identity</h3>
          <div>
            <label className="block text-sm mb-1">Company name</label>
            <input
              className="w-full rounded-lg border p-2"
              value={profile.companyName}
              onChange={onChange('companyName')}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">Company ID / Registration #</label>
              <input
                className="w-full rounded-lg border p-2"
                value={profile.registrationNumber}
                onChange={onChange('registrationNumber')}
              />
            </div>
            <div>
              <label className="block text-sm mb-1">VAT number</label>
              <input
                className="w-full rounded-lg border p-2"
                value={profile.vatNumber}
                onChange={onChange('vatNumber')}
              />
            </div>
          </div>
        </div>

        {/* Contact */}
        <div className="space-y-3">
          <h3 className="font-medium">Contact</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">Email</label>
              <input
                className="w-full rounded-lg border p-2"
                type="email"
                value={profile.email}
                onChange={onChange('email')}
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Phone</label>
              <input
                className="w-full rounded-lg border p-2"
                value={profile.phone}
                onChange={onChange('phone')}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm mb-1">Website</label>
            <input
              className="w-full rounded-lg border p-2"
              placeholder="https://..."
              value={profile.website}
              onChange={onChange('website')}
            />
          </div>
        </div>

        {/* Address */}
        <div className="space-y-3">
          <h3 className="font-medium">Address</h3>
          <div>
            <label className="block text-sm mb-1">Address line 1</label>
            <input
              className="w-full rounded-lg border p-2"
              value={profile.addressLine1}
              onChange={onChange('addressLine1')}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Address line 2</label>
            <input
              className="w-full rounded-lg border p-2"
              value={profile.addressLine2}
              onChange={onChange('addressLine2')}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">City</label>
              <input
                className="w-full rounded-lg border p-2"
                value={profile.city}
                onChange={onChange('city')}
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Region / Province</label>
              <input
                className="w-full rounded-lg border p-2"
                value={profile.region}
                onChange={onChange('region')}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">Postal code</label>
              <input
                className="w-full rounded-lg border p-2"
                value={profile.postalCode}
                onChange={onChange('postalCode')}
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Country</label>
              <input
                className="w-full rounded-lg border p-2"
                value={profile.country}
                onChange={onChange('country')}
              />
            </div>
          </div>
        </div>

        {/* Document prefixes */}
        <div className="space-y-3">
          <h3 className="font-medium">Document Settings</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">Quote prefix</label>
              <input
                className="w-full rounded-lg border p-2"
                placeholder="Q-"
                value={profile.quotePrefix}
                onChange={onChange('quotePrefix')}
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Invoice prefix</label>
              <input
                className="w-full rounded-lg border p-2"
                placeholder="INV-"
                value={profile.invoicePrefix}
                onChange={onChange('invoicePrefix')}
              />
            </div>
          </div>
        </div>

        {/* Banking */}
        <div className="space-y-3">
          <h3 className="font-medium">Banking</h3>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm mb-1">Bank</label>
              <input
                className="w-full rounded-lg border p-2"
                value={profile.bankName}
                onChange={onChange('bankName')}
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Account #</label>
              <input
                className="w-full rounded-lg border p-2"
                value={profile.bankAccountNumber}
                onChange={onChange('bankAccountNumber')}
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Branch code</label>
              <input
                className="w-full rounded-lg border p-2"
                value={profile.bankBranchCode}
                onChange={onChange('bankBranchCode')}
              />
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-3 md:col-span-2">
          <h3 className="font-medium">Notes / Footer</h3>
          <textarea
            className="w-full rounded-lg border p-2 h-28 resize-y"
            placeholder="Payment terms, quote footer, legal notes..."
            value={profile.notes}
            onChange={onChange('notes')}
          />
        </div>
      </div>
    </section>
  )
}
