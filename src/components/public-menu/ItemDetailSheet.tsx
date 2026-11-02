import { useEffect, useState } from 'react';
import { X, Minus, Plus, ShoppingBag } from 'lucide-react';

interface DetailItem {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  discounted_price?: number | null;
  image_url?: string | null;
  tags?: string[] | null;
}

interface DetailVariant {
  id: string;
  label: string;
  price: number;
  // weight_grams is intentionally NOT shown to customers (backend-only).
}

interface ItemDetailSheetProps {
  item: DetailItem;
  variants: DetailVariant[];
  onAdd: (payload: { quantity: number; variant: DetailVariant | null }) => void;
  onClose: () => void;
}

const tagConfig: Record<string, { emoji: string; style: string }> = {
  popular: { emoji: '🔥', style: 'bg-secondary/15 text-secondary border-secondary/30' },
  spicy: { emoji: '🌶️', style: 'bg-destructive/10 text-destructive border-destructive/30' },
  new: { emoji: '✨', style: 'bg-primary/10 text-primary border-primary/30' },
  veg: { emoji: '🥬', style: 'bg-accent text-accent-foreground border-primary/30' },
  bestseller: { emoji: '⭐', style: 'bg-secondary/15 text-secondary border-secondary/30' },
};

export default function ItemDetailSheet({ item, variants, onAdd, onClose }: ItemDetailSheetProps) {
  const hasDiscount = item.discounted_price != null && item.discounted_price < item.price;
  const basePrice = hasDiscount ? item.discounted_price! : item.price;
  const [quantity, setQuantity] = useState(1);
  const [selectedVariant, setSelectedVariant] = useState<DetailVariant | null>(variants[0] || null);

  useEffect(() => {
    setQuantity(1);
    setSelectedVariant(variants[0] || null);
  }, [item.id, variants]);

  const unitPrice = selectedVariant ? selectedVariant.price : basePrice;
  const total = unitPrice * quantity;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-foreground/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={item.name}
        className="relative w-full sm:max-w-md max-h-[92vh] sm:max-h-[85vh] bg-background rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col animate-in slide-in-from-bottom duration-300 overflow-hidden"
      >
        {/* Hero image */}
        <div className="relative h-56 sm:h-64 shrink-0">
          {item.image_url ? (
            <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted via-muted to-accent/30">
              <span className="text-6xl opacity-50">🍽️</span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-transparent to-transparent" />
          <button
            onClick={onClose}
            aria-label="Close item details"
            className="absolute top-3 right-3 h-9 w-9 rounded-full bg-background/90 backdrop-blur-sm shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
          >
            <X className="h-4.5 w-4.5 text-foreground" />
          </button>
          {hasDiscount && item.discounted_price != null && (
            <span className="absolute top-3 left-3 bg-destructive text-destructive-foreground text-[11px] font-bold px-2.5 py-1 rounded-full shadow-md">
              DEAL · Rs.{item.price.toLocaleString()} → Rs.{item.discounted_price.toLocaleString()}
            </span>
          )}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 pt-4 pb-4">
          {/* Name + tags */}
          <h2 className="font-heading text-xl font-extrabold text-foreground leading-tight">{item.name}</h2>
          {item.tags && item.tags.length > 0 && (
            <div className="flex gap-1.5 flex-wrap mt-2">
              {item.tags.map(t => {
                const cfg = tagConfig[t.toLowerCase()] || { emoji: '🏷️', style: 'bg-muted text-muted-foreground border-border' };
                return (
                  <span key={t} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${cfg.style}`}>
                    {cfg.emoji} {t}
                  </span>
                );
              })}
            </div>
          )}

          {/* Description */}
          {item.description && (
            <p className="text-sm text-muted-foreground mt-3 leading-relaxed whitespace-pre-line">{item.description}</p>
          )}

          {/* Variants (sizes / options) */}
          {variants.length > 0 && (
            <div className="mt-5">
              <p className="text-xs font-bold text-foreground uppercase tracking-wide mb-2">Choose Option</p>
              <div className="space-y-2">
                {variants.map(v => {
                  const active = selectedVariant?.id === v.id;
                  return (
                    <button
                      key={v.id}
                      onClick={() => setSelectedVariant(v)}
                      className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl border-2 text-left transition-all ${
                        active ? 'border-primary bg-primary/5 shadow-sm' : 'border-border hover:border-primary/30'
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <span className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${active ? 'border-primary' : 'border-muted-foreground/40'}`}>
                          {active && <span className="h-2 w-2 rounded-full bg-primary" />}
                        </span>
                        <span className="text-sm font-semibold text-foreground">{v.label}</span>
                      </span>
                      <span className="font-heading font-bold text-sm text-foreground">Rs.{v.price.toLocaleString()}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer: quantity + add to cart */}
        <div className="shrink-0 border-t bg-background px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-muted rounded-full p-1 shrink-0">
              <button
                onClick={() => setQuantity(q => Math.max(1, q - 1))}
                disabled={quantity <= 1}
                aria-label="Decrease quantity"
                className="h-9 w-9 rounded-full bg-background flex items-center justify-center shadow-sm active:scale-90 transition-transform disabled:opacity-40"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-7 text-center font-heading font-extrabold text-base text-foreground">{quantity}</span>
              <button
                onClick={() => setQuantity(q => q + 1)}
                aria-label="Increase quantity"
                className="h-9 w-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-sm active:scale-90 transition-transform"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <button
              onClick={() => onAdd({ quantity, variant: selectedVariant })}
              className="flex-1 h-12 rounded-2xl bg-primary text-primary-foreground font-heading font-bold text-sm shadow-lg flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
            >
              <ShoppingBag className="h-4 w-4" />
              Add to Cart · Rs.{total.toLocaleString()}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
