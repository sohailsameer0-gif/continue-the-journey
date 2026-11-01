import { useEffect, useState } from 'react';
import { X, MapPin, Loader2 } from 'lucide-react';

interface WelcomeLocationPopupProps {
  outlet: { name: string; logo_url?: string | null };
  deliveryEnabled: boolean;
  takeawayEnabled: boolean;
  /** Previously used details (same session) to prefill */
  previous?: { address?: string; locationLink?: string } | null;
  onSelect: (selection: { orderType: 'delivery' | 'takeaway'; city: string; area: string; address: string; locationLink: string }) => void;
  onClose: () => void;
}

/**
 * Welcome popup shown when a customer first opens the public menu (per visit).
 * Mirrors the reference flow: outlet logo + name, order type selection
 * (Delivery / Pick-Up), GPS location fetch, City and Area fields, then Select.
 * The chosen type, address and location link are carried into the order.
 */
export default function WelcomeLocationPopup({
  outlet, deliveryEnabled, takeawayEnabled, previous, onSelect, onClose,
}: WelcomeLocationPopupProps) {
  const [orderType, setOrderType] = useState<'delivery' | 'takeaway' | null>(null);
  const [city, setCity] = useState('');
  const [area, setArea] = useState('');
  const [locationLink, setLocationLink] = useState('');
  const [fetching, setFetching] = useState(false);
  const [geoError, setGeoError] = useState('');
  const [geoOk, setGeoOk] = useState(false);

  // Prefill from the previous delivery in this session (if any)
  useEffect(() => {
    if (previous?.address) {
      const parts = previous.address.split(',').map(p => p.trim());
      if (parts.length >= 2) {
        setArea(parts[0]);
        setCity(parts.slice(1).join(', '));
      } else {
        setArea(previous.address);
      }
    }
    if (previous?.locationLink) {
      setLocationLink(previous.locationLink);
      setGeoOk(true);
    }
  }, [previous]);

  const fetchLocation = () => {
    if (!('geolocation' in navigator)) {
      setGeoError('Location is not supported on this device. Please enter City & Area manually.');
      return;
    }
    setFetching(true);
    setGeoError('');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setLocationLink(`https://www.google.com/maps?q=${latitude},${longitude}`);
        setGeoOk(true);
        // Reverse geocode to prefill City / Area (best effort, manual entry still works)
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&accept-language=en`
          );
          const data = await res.json();
          const a = data?.address || {};
          const detectedCity = a.city || a.town || a.village || a.county || a.state_district || '';
          const detectedArea = a.suburb || a.neighbourhood || a.residential || a.quarter || a.road || '';
          if (detectedCity) setCity(detectedCity);
          if (detectedArea) setArea(detectedArea);
        } catch {
          /* keep manual entry */
        }
        setFetching(false);
      },
      () => {
        setFetching(false);
        setGeoError('Location permission was denied. Please enter City & Area manually.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  const needsLocation = orderType === 'delivery';
  const canSelect = !!orderType && (!needsLocation || (!!locationLink || (!!city.trim() && !!area.trim())));

  const handleSelect = () => {
    if (!orderType || !canSelect) return;
    const address = [area.trim(), city.trim()].filter(Boolean).join(', ');
    onSelect({
      orderType,
      city: city.trim(),
      area: area.trim(),
      address,
      locationLink: locationLink,
    });
  };

  return (
    <div className="fixed inset-0 z-[60] bg-foreground/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Welcome to ${outlet.name}`}
        className="relative w-full max-w-sm rounded-3xl bg-card shadow-2xl border p-6 animate-in zoom-in-95 duration-300"
      >
        <button
          onClick={onClose}
          aria-label="Skip"
          className="absolute right-3 top-3 h-8 w-8 rounded-full bg-muted hover:bg-muted/80 flex items-center justify-center transition-colors"
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </button>

        {/* Outlet logo + name side by side */}
        <div className="flex items-center justify-center gap-3 pt-1 pb-4">
          {outlet.logo_url ? (
            <img
              src={outlet.logo_url}
              alt={`${outlet.name} logo`}
              className="w-14 h-14 rounded-full object-cover ring-2 ring-primary/20 shadow-md shrink-0"
            />
          ) : (
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-md shrink-0">
              <span className="text-xl font-bold text-primary-foreground">{outlet.name.charAt(0)}</span>
            </div>
          )}
          <h2 className="font-heading text-lg font-extrabold text-foreground leading-tight text-left">
            {outlet.name}
          </h2>
        </div>

        {/* Order type */}
        <p className="text-center font-heading text-sm font-bold text-foreground">Select your order type</p>
        <div className="mt-3 flex items-center justify-center gap-2">
          {deliveryEnabled && (
            <button
              onClick={() => setOrderType('delivery')}
              className={`px-6 py-2 rounded-full text-sm font-semibold transition-all ${
                orderType === 'delivery'
                  ? 'bg-primary text-primary-foreground shadow-md'
                  : 'border border-border text-foreground hover:border-primary/40'
              }`}
            >
              Delivery
            </button>
          )}
          {takeawayEnabled && (
            <button
              onClick={() => setOrderType('takeaway')}
              className={`px-6 py-2 rounded-full text-sm font-semibold transition-all ${
                orderType === 'takeaway'
                  ? 'bg-primary text-primary-foreground shadow-md'
                  : 'border border-border text-foreground hover:border-primary/40'
              }`}
            >
              Pick-Up
            </button>
          )}
        </div>

        {/* Location */}
        {orderType === 'delivery' && (
          <div className="mt-5">
            <p className="text-center text-sm font-semibold text-foreground">Please select your location</p>
            <div className="mt-2 flex justify-center">
              <button
                onClick={fetchLocation}
                disabled={fetching}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-muted text-sm font-medium text-foreground disabled:opacity-70 transition-all hover:bg-muted/80"
              >
                {fetching ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    Fetching Location...
                  </>
                ) : geoOk ? (
                  <>
                    <MapPin className="h-4 w-4 text-primary" />
                    Location captured
                  </>
                ) : (
                  <>
                    <MapPin className="h-4 w-4 text-primary" />
                    Use my current location
                  </>
                )}
              </button>
            </div>
            {geoError && (
              <p className="mt-2 text-center text-[11px] text-destructive px-2">{geoError}</p>
            )}

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-semibold text-foreground block mb-1.5">Select City / Region</label>
                <input
                  type="text"
                  value={city}
                  onChange={e => setCity(e.target.value)}
                  placeholder="e.g. Peshawar"
                  className="w-full h-11 rounded-xl bg-background border border-border px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground block mb-1.5">Select Area / Sub Region</label>
                <input
                  type="text"
                  value={area}
                  onChange={e => setArea(e.target.value)}
                  placeholder="e.g. University Road"
                  className="w-full h-11 rounded-xl bg-background border border-border px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>
          </div>
        )}
        {orderType === 'takeaway' && (
          <p className="mt-5 text-center text-xs text-muted-foreground">
            You will pick up your order from the restaurant — no delivery details needed.
          </p>
        )}
        {!orderType && (
          <p className="mt-5 text-center text-xs text-muted-foreground">
            Choose how you would like your order first.
          </p>
        )}

        <button
          onClick={handleSelect}
          disabled={!canSelect}
          className="mt-5 w-full h-11 rounded-xl bg-primary text-primary-foreground text-sm font-bold shadow-md transition-all disabled:opacity-40 disabled:shadow-none active:scale-[0.99]"
        >
          Select
        </button>
      </div>
    </div>
  );
}
