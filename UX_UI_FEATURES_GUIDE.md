# New UX/UI Features Guide

## 1. 🔔 Toast Notifications
Provide feedback to users for their actions.

```tsx
import { useToast } from "@/lib/toast";

function MyComponent() {
  const { add } = useToast();

  return (
    <button onClick={() => add("Customer saved!", "success")}>
      Save
    </button>
  );
}
```

**Types:** `success`, `error`, `info`, `warning`
**Duration:** Auto-dismiss after 3 seconds (optional)

---

## 2. ⌨️ Command Palette
Press **Cmd+K** or **Ctrl+K** to open the command palette. Provides quick navigation to all major pages.

**Keyboard shortcuts:**
- `Cmd+K` / `Ctrl+K` - Open/close palette
- `Escape` - Close palette
- Type to search commands
- `Cmd+1` through `Cmd+7` - Quick navigation to pages

---

## 3. 📊 Status Badges
Display record status with visual indicators.

```tsx
import StatusBadge from "@/components/StatusBadge";

<StatusBadge status="draft" showDot />
<StatusBadge status="completed" />
```

**Available statuses:**
- `draft`, `sent`, `accepted`, `invoiced`
- `in-progress`, `completed`, `cancelled`
- `tentative`, `confirmed`
- `active`, `inactive`

---

## 4. 🔄 Undo/Redo System
Track and manage action history.

```tsx
import { useHistory } from "@/lib/history";

function MyComponent() {
  const { add, undo, redo, canUndo, canRedo } = useHistory();

  const handleDelete = (id: string) => {
    const oldData = getData(id); // save current state
    deleteRecord(id); // perform deletion

    add({
      id: `delete-${id}`,
      name: "Delete record",
      undo: () => restoreRecord(oldData),
      redo: () => deleteRecord(id),
      timestamp: Date.now(),
    });
  };

  return (
    <>
      <button onClick={undo} disabled={!canUndo()}>Undo</button>
      <button onClick={redo} disabled={!canCanRedo()}>Redo</button>
    </>
  );
}
```

---

## 5. ⭐ Favorites System
Let users mark favorite customers/jobs for quick access.

```tsx
import { useFavorites } from "@/lib/favorites";

function CustomerItem({ customerId }: { customerId: string }) {
  const { isFavorited, toggle } = useFavorites();
  const isFav = isFavorited(customerId);

  return (
    <button 
      onClick={() => toggle(customerId)}
      className={isFav ? "text-amber-500" : "text-slate-400"}
    >
      ★
    </button>
  );
}
```

---

## 6. 📂 Breadcrumb Navigation
Show page hierarchy.

```tsx
import Breadcrumb from "@/components/Breadcrumb";

<Breadcrumb
  items={[
    { label: "Dashboard", href: "#/" },
    { label: "Customers", href: "#/customers" },
    { label: "John Doe" },
  ]}
/>
```

---

## 7. ⚙️ Loading & Empty States
Handle data loading and empty results gracefully.

```tsx
import { LoadingSpinner, EmptyState, LoadingSkeleton } from "@/components/LoadingSpinner";

// Loading spinner
<LoadingSpinner size="md" />

// Loading skeleton for lists
{isLoading ? <LoadingSkeleton /> : <CustomerList />}

// Empty state with action
<EmptyState
  title="No customers yet"
  description="Create your first customer to get started"
  action={{
    label: "Create Customer",
    onClick: () => window.location.hash = "#/customers/new",
  }}
/>
```

---

## 8. 💾 Form Validation
Enhanced form error display.

```tsx
{error && (
  <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">
    {error}
  </div>
)}
```

---

## 9. 📋 Bulk Actions
Add checkboxes to lists for batch operations.

```tsx
const [selected, setSelected] = useState<Set<string>>(new Set());

const toggleSelect = (id: string) => {
  const next = new Set(selected);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  setSelected(next);
};

return (
  <>
    {selected.size > 0 && (
      <div className="p-3 bg-blue-50 border-l-4 border-blue-500">
        <button onClick={() => bulkDelete([...selected])}>
          Delete {selected.size} items
        </button>
      </div>
    )}
    {items.map((item) => (
      <label key={item.id}>
        <input
          type="checkbox"
          checked={selected.has(item.id)}
          onChange={() => toggleSelect(item.id)}
        />
        {item.name}
      </label>
    ))}
  </>
);
```

---

## 10. 📱 Mobile Optimization
Features automatically adapt to mobile:
- Sidebar collapses/hides
- Touch-friendly buttons (44x44px minimum)
- Responsive grid layouts
- Modal takes full width on small screens

---

## Implementation Checklist

- [ ] Toast notifications added to all forms
- [ ] Status badges added to Customers, Jobs, Quotes pages
- [ ] Breadcrumbs added to detail pages
- [ ] Loading states for all data fetches
- [ ] Undo/Redo for critical operations (delete)
- [ ] Favorites/stars on Customers and Jobs
- [ ] Bulk actions on list pages
- [ ] Empty states for all pages
- [ ] Mobile responsive testing
- [ ] Keyboard shortcut documentation

---

## Reverting Changes

If you want to remove any of these features:

```bash
git reset HEAD~1  # Undo last commit
git checkout -- . # Revert all changes
```

Or remove specific files:
```bash
rm src/lib/toast.ts
rm src/components/ToastContainer.tsx
# etc...
```
