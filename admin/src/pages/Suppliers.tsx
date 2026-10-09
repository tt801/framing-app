import { useEffect, useState, type FormEvent } from 'react';
import { listSuppliers, listSupplierProducts, createSupplier, updateSupplier, createSupplierProduct, updateSupplierProduct, type PlatformSupplier, type PlatformSupplierProduct } from '@/lib/api';

const supplierStatuses = ['draft', 'active', 'paused', 'retired'];
const rights = ['unknown', 'permitted', 'restricted', 'prohibited'];
const categories = ['frame', 'mat', 'glazing', 'printing', 'backer', 'other'];
const lifecycles = ['active', 'discontinued', 'superseded'];
const availabilities = ['unknown', 'available', 'limited', 'unavailable'];
const taxBases = ['exclusive', 'inclusive', 'exempt', 'unknown'];
const optionalText = ['display_description', 'subcategory', 'collection_name', 'colour', 'finish', 'material', 'purchase_unit', 'mat_core', 'mat_quality', 'glazing_material', 'glazing_reflection'] as const;
const dimensions = ['width_mm', 'depth_mm', 'rebate_width_mm', 'rebate_depth_mm', 'sheet_width_mm', 'sheet_height_mm', 'mat_thickness_mm', 'glazing_thickness_mm', 'glazing_uv_percent'] as const;
const categoryDimensions: Record<string, readonly string[]> = {
  frame: ['width_mm', 'depth_mm', 'rebate_width_mm', 'rebate_depth_mm'],
  mat: ['sheet_width_mm', 'sheet_height_mm', 'mat_thickness_mm'],
  glazing: ['sheet_width_mm', 'sheet_height_mm', 'glazing_thickness_mm', 'glazing_uv_percent'],
  printing: ['sheet_width_mm', 'sheet_height_mm'], backer: ['sheet_width_mm', 'sheet_height_mm'], other: [...dimensions],
};
const fieldLabel = (key: string) => {
  const name = key.replace(/_/g, ' ').replace(/^./, first => first.toUpperCase()).replace('Uv ', 'UV ');
  return key.endsWith('_mm') ? `${name.slice(0, -3)} (mm)` : key === 'glazing_uv_percent' ? 'Glazing UV (%)' : name;
};
const slugHint = 'Lowercase letters and numbers only. Use hyphens between words, e.g. larson-juhl.';
const slugFromName = (name: string) => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
type SupplierForm = { name: string; slug: string; status: string; countries: string; asset_rights_status: string };
type ProductForm = Record<string, string>;
const blankSupplier: SupplierForm = { name: '', slug: '', status: 'draft', countries: '', asset_rights_status: 'unknown' };
const blankProduct: ProductForm = {
  catalog_scope: 'default', source_product_key: '', supplier_sku: '', variant_key: '', category: 'frame', supplier_description: '',
  lifecycle: 'active', availability: 'unknown', wholesale_cost: '', cost_currency: '', cost_unit: '', cost_tax_basis: '', cost_effective_at: '',
};
const costKeys = ['wholesale_cost', 'cost_currency', 'cost_unit', 'cost_tax_basis', 'cost_effective_at'] as const;
function localDateTime(instant: string) {
  const date = new Date(instant);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function formFromProduct(item: PlatformSupplierProduct): ProductForm {
  const form: ProductForm = { ...blankProduct };
  for (const key of Object.keys(blankProduct).concat([...optionalText], [...dimensions])) {
    const value = item[key as keyof PlatformSupplierProduct];
    form[key] = value == null ? '' : String(value);
  }
  form.cost_effective_at = item.cost_effective_at ? localDateTime(item.cost_effective_at) : '';
  return form;
}
function supplierFields(form: SupplierForm, create: boolean) {
  return { name: form.name, ...(create ? { slug: form.slug } : {}), status: form.status,
    countries: form.countries.split(',').map(x => x.trim().toUpperCase()).filter(Boolean), asset_rights_status: form.asset_rights_status };
}
function productFields(form: ProductForm, create: boolean): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    category: form.category, supplier_description: form.supplier_description, lifecycle: form.lifecycle, availability: form.availability,
    wholesale_cost: form.wholesale_cost === '' ? null : Number(form.wholesale_cost),
    cost_currency: form.cost_currency || null, cost_unit: form.cost_unit || null,
    cost_tax_basis: form.cost_tax_basis || null,
    cost_effective_at: form.cost_effective_at ? new Date(form.cost_effective_at).toISOString() : null,
  };
  if (create) Object.assign(fields, { catalog_scope: form.catalog_scope, source_product_key: form.source_product_key || null,
    supplier_sku: form.supplier_sku || null, variant_key: form.variant_key });
  for (const key of optionalText) fields[key] = form[key] || null;
  for (const key of dimensions) fields[key] = form[key] === undefined || form[key] === '' ? null : Number(form[key]);
  return fields;
}
function changedProductFields(form: ProductForm, original: PlatformSupplierProduct): Record<string, unknown> {
  const before = formFromProduct(original);
  const values = productFields(form, false);
  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!costKeys.includes(key as typeof costKeys[number]) && form[key] !== before[key]) changed[key] = value;
  }
  // Validation requires the complete cost tuple on any cost edit. Preserve the
  // original instant when only the other cost fields have changed.
  if (costKeys.some(key => form[key] !== before[key])) {
    for (const key of costKeys) changed[key] = key === 'cost_effective_at' && form[key] === before[key] ? original.cost_effective_at : values[key];
  }
  return changed;
}
function Input({ label, value, onChange, required = false, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; required?: boolean; type?: string }) {
  return <label className="supplier-field">{label}<input className="form-input" type={type} step={type === 'number' ? 'any' : undefined} value={value} required={required} onChange={e => onChange(e.target.value)} /></label>;
}
function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return <label className="supplier-field">{label}<select className="filter-select" value={value} onChange={e => onChange(e.target.value)}>{options.map(o => <option key={o} value={o}>{o}</option>)}</select></label>;
}

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState<PlatformSupplier[]>([]);
  const [selected, setSelected] = useState<PlatformSupplier | null>(null);
  const [products, setProducts] = useState<PlatformSupplierProduct[]>([]);
  const [supplierEdit, setSupplierEdit] = useState<PlatformSupplier | 'new' | null>(null);
  const [productEdit, setProductEdit] = useState<PlatformSupplierProduct | 'new' | null>(null);
  const [supplierForm, setSupplierForm] = useState<SupplierForm>(blankSupplier);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [productForm, setProductForm] = useState<ProductForm>(blankProduct);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  async function refreshSuppliers() {
    setLoading(true);
    try { setSuppliers((await listSuppliers()).suppliers); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load suppliers'); }
    finally { setLoading(false); }
  }
  async function selectSupplier(item: PlatformSupplier) {
    setSelected(item); setProductEdit(null); setError('');
    try { setProducts((await listSupplierProducts(item.id)).products); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load products'); }
  }
  useEffect(() => { void refreshSuppliers(); }, []);
  function editSupplier(item: PlatformSupplier | 'new') {
    setSupplierEdit(item); setError(''); setSlugManuallyEdited(false);
    setSupplierForm(item === 'new' ? blankSupplier : { name: item.name, slug: item.slug, status: item.status, countries: item.countries.join(','), asset_rights_status: item.asset_rights_status });
  }
  function editProduct(item: PlatformSupplierProduct | 'new') {
    setProductEdit(item); setError('');
    if (item === 'new') { setProductForm(blankProduct); return; }
    setProductForm(formFromProduct(item));
  }
  async function saveSupplier(event: FormEvent) {
    event.preventDefault(); if (!supplierEdit || busy) return;
    setBusy(true); setError('');
    try {
      const result = supplierEdit === 'new' ? await createSupplier(supplierFields(supplierForm, true)) : await updateSupplier(supplierEdit.id, supplierFields(supplierForm, false));
      setSupplierEdit(null); await refreshSuppliers();
      if (selected?.id === result.supplier.id) setSelected(result.supplier);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save supplier'); }
    finally { setBusy(false); }
  }
  async function saveProduct(event: FormEvent) {
    event.preventDefault(); if (!selected || !productEdit || busy) return;
    setBusy(true); setError('');
    try {
      if (productEdit === 'new') await createSupplierProduct(selected.id, productFields(productForm, true));
      else {
        const fields = changedProductFields(productForm, productEdit);
        if (Object.keys(fields).length) await updateSupplierProduct(selected.id, productEdit.id, productEdit.updated_at, fields);
      }
      setProductEdit(null);
      setProducts((await listSupplierProducts(selected.id)).products);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save product'); }
    finally { setBusy(false); }
  }
  const sf = (key: keyof SupplierForm) => (value: string) => {
    if (key === 'slug') setSlugManuallyEdited(true);
    setSupplierForm(prev => ({ ...prev, [key]: value,
      ...(key === 'name' && supplierEdit === 'new' && !slugManuallyEdited ? { slug: slugFromName(value) } : {}) }));
  };
  const pf = (key: string) => (value: string) => setProductForm(prev => ({ ...prev, [key]: value }));
  return <div className="page supplier-page">
    <div className="toolbar"><button className="btn-primary" onClick={() => editSupplier('new')}>New supplier</button><button className="btn-icon" onClick={() => void refreshSuppliers()}>Refresh</button></div>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <div className="card"><h2>Suppliers</h2>{loading ? <p>Loading…</p> : suppliers.length === 0 ? <p>No suppliers yet.</p> :
      <div className="supplier-list">{suppliers.map(item => <button type="button" className="sidebar-item" key={item.id} onClick={() => void selectSupplier(item)}>{item.name} · {item.slug} · {item.status}</button>)}</div>}</div>
    {supplierEdit && <form className="card supplier-form" onSubmit={e => void saveSupplier(e)}>
      <h2>{supplierEdit === 'new' ? 'New supplier' : `Edit ${supplierEdit.name}`}</h2>
      <Input label="Supplier name" value={supplierForm.name} onChange={sf('name')} required />
      {supplierEdit === 'new' ? <><Input label="Supplier slug" value={supplierForm.slug} onChange={sf('slug')} required /><small>{slugHint}</small></> : <p>Slug: {supplierForm.slug} (permanent supplier identity)</p>}
      <Select label="Status" value={supplierForm.status} options={supplierStatuses} onChange={sf('status')} />
      <Input label="Countries (ISO 2-letter codes, comma-separated)" value={supplierForm.countries} onChange={sf('countries')} />
      <Select label="Asset rights status" value={supplierForm.asset_rights_status} options={rights} onChange={sf('asset_rights_status')} />
      <div><button className="btn-primary" disabled={busy}>Save supplier</button> <button type="button" onClick={() => setSupplierEdit(null)}>Cancel</button></div>
    </form>}
    {selected && <section className="card"><div className="toolbar"><h2>{selected.name} · Products</h2><button className="btn-primary" onClick={() => editProduct('new')}>New product</button><button onClick={() => editSupplier(selected)}>Edit supplier</button><button onClick={() => void selectSupplier(selected)}>Refresh products</button></div>
      <div>Slug: {selected.slug} · Rights: {selected.asset_rights_status}. Image rights metadata is informational; no supplier images are activated for customers. <details><summary>Technical ID</summary><code>{selected.id}</code></details></div>
      {products.length === 0 ? <p>No products yet.</p> : <table className="table"><thead><tr><th>SKU / source key</th><th>Product</th><th>Lifecycle</th><th>Availability</th><th>Private wholesale</th><th>Asset/licensing (metadata only)</th><th>Action</th></tr></thead><tbody>{products.map(item => <tr key={item.id}><td>{item.supplier_sku || '—'}<br />{item.source_product_key || '—'}<br />{item.catalog_scope} / {item.variant_key || 'default'}<br /><details><summary>Product ID</summary><code>{item.id}</code></details></td><td>{item.supplier_description}<br />{item.category}</td><td>{item.lifecycle}</td><td>{item.availability}</td><td>{item.wholesale_cost == null ? '—' : `${item.wholesale_cost} ${item.cost_currency} / ${item.cost_unit}`}<br /><small>{item.cost_tax_basis} {item.cost_effective_at}</small></td><td>Rights: {item.image_rights_status}; status: {item.asset_status}<br />Attribution: {item.source_attribution || '—'}<br />Permitted uses: {JSON.stringify(item.image_permitted_uses ?? {})}<br />Source URL: {item.source_image_url || '—'}<br />Cached references: {[item.cached_asset_key, item.thumbnail_key, item.texture_key].filter(Boolean).join(', ') || '—'} (not displayed)</td><td><button onClick={() => editProduct(item)}>Edit metadata</button></td></tr>)}</tbody></table>}
    </section>}
    {selected && productEdit && <form className="card supplier-form" onSubmit={e => void saveProduct(e)}>
      <h2>{productEdit === 'new' ? 'New manual product' : 'Edit product metadata'}</h2>
      <p>Supplier: {selected.name}. SKU, source key, scope and variant are immutable after creation. Costs are Private Platform Admin information; no delete, alias or cost-event action is provided.</p>
      {productEdit === 'new' ? <><Input label="Catalog scope" value={productForm.catalog_scope} onChange={pf('catalog_scope')} required /><Input label="Source product key" value={productForm.source_product_key} onChange={pf('source_product_key')} /><Input label="Supplier SKU" value={productForm.supplier_sku} onChange={pf('supplier_sku')} /><Input label="Variant key" value={productForm.variant_key} onChange={pf('variant_key')} /></> : <p>SKU: {productEdit.supplier_sku || '—'} · Source key: {productEdit.source_product_key || '—'} · Scope: {productEdit.catalog_scope} · Variant: {productEdit.variant_key || 'default'}</p>}
      <Select label="Category" value={productForm.category} options={categories} onChange={pf('category')} />
      <Input label="Supplier description" value={productForm.supplier_description} onChange={pf('supplier_description')} required />
      <Select label="Lifecycle" value={productForm.lifecycle} options={lifecycles} onChange={pf('lifecycle')} />
      <Select label="Availability" value={productForm.availability} options={availabilities} onChange={pf('availability')} />
      {optionalText.filter(key => !['mat_core', 'mat_quality', 'glazing_material', 'glazing_reflection'].includes(key) ||
        productForm[key] || productForm.category === 'other' || (key.startsWith('mat_') ? productForm.category === 'mat' : productForm.category === 'glazing')).map(key =>
        <Input key={key} label={fieldLabel(key)} value={productForm[key] || ''} onChange={pf(key)} />)}
      {dimensions.filter(key => (categoryDimensions[productForm.category] || dimensions).includes(key) || productForm[key]).map(key =>
        <Input key={key} label={fieldLabel(key)} value={productForm[key] || ''} onChange={pf(key)} type="number" />)}
      <h3>Private wholesale cost</h3><p>Supply all cost fields together or leave all blank. Changes to an existing cost, including clearing it, are recorded in append-only history.</p>
      <Input label="Wholesale cost" value={productForm.wholesale_cost} onChange={pf('wholesale_cost')} type="number" />
      <Input label="Currency (ISO 3-letter code)" value={productForm.cost_currency} onChange={pf('cost_currency')} />
      <Input label="Cost unit" value={productForm.cost_unit} onChange={pf('cost_unit')} />
      <Select label="Cost tax basis" value={productForm.cost_tax_basis} options={['', ...taxBases]} onChange={pf('cost_tax_basis')} />
      <Input label="Cost effective date" value={productForm.cost_effective_at} onChange={pf('cost_effective_at')} type="datetime-local" /><small>Displayed in your browser's local time zone; saved as a UTC instant.</small>
      <div><button className="btn-primary" disabled={busy}>Save product</button> <button type="button" onClick={() => setProductEdit(null)}>Cancel</button></div>
    </form>}
  </div>;
}
