// src/components/Breadcrumb.tsx - Navigation breadcrumbs
import { Fragment } from "react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export default function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav className="flex items-center gap-2 text-sm text-slate-600">
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && <span className="text-slate-400">/</span>}
          {item.href ? (
            <a href={item.href} className="hover:text-slate-900 transition-colors">
              {item.label}
            </a>
          ) : (
            <span className="text-slate-900 font-medium">{item.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
