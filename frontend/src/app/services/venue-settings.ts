export interface VenueMedia { id: string; kind: 'logo' | 'photo' | 'share'; url: string; width: number; height: number; }
export interface VenuePhoto extends VenueMedia { caption: string; }
export interface VenueSettings {
  advance_payment_percentage: number;
  turf_name: string; turf_address: string; turf_phone: string; turf_email: string;
  turf_whatsapp: string; turf_maps_url: string; turf_description: string;
  turf_facilities: string[]; turf_logo_id: string | null; turf_logo: VenueMedia | null; turf_photos: VenuePhoto[];
  turf_share_image_id: string | null; turf_share_image: VenueMedia | null;
  cancellation_policy?: any;
}
export type VenueUpdate = Partial<Omit<VenueSettings, 'turf_logo' | 'turf_photos' | 'turf_share_image' | 'cancellation_policy'>> & { turf_photos?: { id: string; caption: string }[] };
