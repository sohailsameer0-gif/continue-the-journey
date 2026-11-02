import { Plus } from 'lucide-react';

interface MenuItem {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  discounted_price?: number | null;
  image_url?: string | null;
  tags?: string[] | null;
}

interface MenuItemCardProps {
  item: MenuItem;
  quantity: number;
  onOpen: () => void;
  onAdd: () => void;
}

const tagConfig: Record<string, { emoji: string }> = {
  popular: { emoji: '🔥' },
  spicy: { emoji: '🌶️' },
  new: { emoji: '✨' },
  veg: { emoji: '🥬' },
  bestseller: { emoji: '⭐' },
};

export default function MenuItemCard({ item, quantity, onOpen, onAdd }: MenuItemCardProps) {
  const hasDiscount = item.discounted_price != null && item.discounted_price < item.price;
  const displayPrice = hasDiscount ? item.discounted_price! : item.price;
  const discount = hasDiscount ? Math.round(((item.price - item.discounted_price!) / item.price) * 100) : 0;

  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      className="group bg-card rounded-2xl border shadow-card hover:shadow-card-hover active:scale-[0.98] transition-all duration-200 overflow-hidden cursor-pointer flex flex-col text-left"
    >
      {/* Image */}
      <div className="relative aspect-[4/3] overflow-hidden">
        {item.image_url ? (
          <img
            src={item.image_url}
            alt={item.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted via-muted to-accent/30">
            <span className="text-4xl opacity-50">🍽️</span>
          </div>
        )}

        {hasDiscount && (
          <span className="absolute top-2 left-2 bg-destructive text-destructive-foreground text-[10px] font-bold px-2 py-0.5 rounded-full shadow-md">
            DEAL · {discount}% OFF
          </span>
        )}

        {quantity > 0 && (
          <span className="absolute top-2 right-2 bg-primary text-primary-foreground text-[10px] font-bold h-5 min-w-5 px-1.5 rounded-full flex items-center justify-center shadow-md">
            {quantity}
          </span>
        )}

        {/* Add button */}
        <button
          onClick={e => { e.stopPropagation(); onAdd(); }}
          aria-label={`Add ${item.name} to cart`}
          className="absolute bottom-2 right-2 h-9 w-9 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:scale-110 active:scale-95 transition-transform"
        >
          <Plus className="h-4.5 w-4.5" />
        </button>
      </div>

      {/* Content */}
      <div className="p-3 flex flex-col gap-1 flex-1">
        <h3 className="font-heading font-bold text-sm text-foreground leading-snug line-clamp-1">{item.name}</h3>
        {item.description && (
          <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">{item.description}</p>
        )}
        {item.tags && item.tags.length > 0 && (
          <div className="flex gap-1 flex-wrap mt-0.5">
            {item.tags.slice(0, 2).map(t => {
              const cfg = tagConfig[t.toLowerCase()] || { emoji: '🏷️' };
              return (
                <span key={t} className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5">
                  {cfg.emoji} {t}
                </span>
              );
            })}
          </div>
        )}
        <div className="flex items-baseline gap-1.5 mt-auto pt-1.5">
          <span className="font-heading font-extrabold text-base text-foreground">Rs.{displayPrice.toLocaleString()}</span>
          {hasDiscount && (
            <span className="line-through text-[11px] text-muted-foreground/60">Rs.{item.price.toLocaleString()}</span>
          )}
        </div>
      </div>
    </div>
  );
}
