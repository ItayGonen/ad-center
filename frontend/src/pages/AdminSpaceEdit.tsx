import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getSpaceDetail, getAudienceProfiles, getSpaceTypes } from '../services/spaces';
import type { SpaceImage, OperatingHours, AudienceProfile, SpaceTypeItem, Screen } from '../services/spaces';
import { createAdminSpace, updateAdminSpace, uploadSpaceImage, deleteSpaceImage, addOperatingHours, deleteOperatingHours, addScreen, updateScreen, deleteScreen, getPartners, getSpaceTranslations, getScreenTranslations, setScreenTranslations } from '../services/admin';
import type { ScreenTranslations } from '../services/admin';
import type { PartnerOption } from '../services/admin';
import { useModal } from '../context/ModalContext';
import Loader from '../components/Loader';
import { API_URL } from '../services/api';

interface HeTranslations {
  name: string;
  general_description: string;
  city: string;
  full_address: string;
}

const emptyHeTranslations: HeTranslations = {
  name: '', general_description: '', city: '', full_address: '',
};

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

interface SpaceForm {
  name: string;
  general_description: string;
  city: string;
  full_address: string;
  lat: string;
  lng: string;
  estimated_daily_impressions: string;
  price_per_day: string;
  space_type_id: string;
  audience_profile_ids: number[];
  environment: string;
  average_dwell_time: string;
  partner_owner: string;
}

const emptyForm: SpaceForm = {
  name: '', general_description: '', city: '', full_address: '',
  lat: '', lng: '', estimated_daily_impressions: '',
  price_per_day: '', space_type_id: '', audience_profile_ids: [],
  environment: '', average_dwell_time: '', partner_owner: '',
};

interface DayHours {
  enabled: boolean;
  start_time: string;
  end_time: string;
  existingId?: number; // for saved hours
}

const defaultWeek: DayHours[] = Array.from({ length: 7 }, () => ({
  enabled: false,
  start_time: '09:00',
  end_time: '18:00',
}));

interface PendingImage {
  id: string;
  file: File;
  preview: string;
}

interface ScreenEntry {
  existingId?: number;
  name: string;
  name_he: string;
  size_inches: string;
  resolution_width: string;
  resolution_height: string;
  position_description: string;
  position_description_he: string;
  is_active: boolean;
}

export default function AdminSpaceEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('admin');
  const modal = useModal();
  const isEdit = id !== undefined;

  const DAY_NAMES = t('dayNames', { ns: 'common', returnObjects: true }) as string[];
  const DAY_SHORT = t('dayNamesShort', { ns: 'common', returnObjects: true }) as string[];

  const [form, setForm] = useState<SpaceForm>(emptyForm);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Language tabs
  const [activeLang, setActiveLang] = useState<'en' | 'he'>('en');
  const [heTranslations, setHeTranslations] = useState<HeTranslations>(emptyHeTranslations);

  // Images
  const [images, setImages] = useState<SpaceImage[]>([]);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Operating hours — weekly grid
  const [weekHours, setWeekHours] = useState<DayHours[]>(defaultWeek.map(d => ({ ...d })));
  const [hoursLoaded, setHoursLoaded] = useState(false);

  // Screens
  const [screens, setScreens] = useState<ScreenEntry[]>([]);
  const [screensLoaded, setScreensLoaded] = useState(false);

  // Lookup data
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [audienceProfiles, setAudienceProfiles] = useState<AudienceProfile[]>([]);
  const [spaceTypes, setSpaceTypes] = useState<SpaceTypeItem[]>([]);

  // Active section for sidebar nav
  const [activeSection, setActiveSection] = useState('basic');

  useEffect(() => {
    getPartners().then(setPartners).catch(() => {});
    getAudienceProfiles().then(setAudienceProfiles).catch(() => {});
    getSpaceTypes().then(setSpaceTypes).catch(() => {});
  }, []);

  useEffect(() => {
    if (isEdit && id) {
      setLoading(true);
      const spaceId = Number(id);
      Promise.all([
        getSpaceDetail(spaceId, 'en'),
        getSpaceTranslations(spaceId).catch(() => ({})),
        getScreenTranslations(spaceId).catch(() => ({} as ScreenTranslations)),
      ])
        .then(([detail, translations, screenTrans]) => {
          setForm({
            name: detail.name || '',
            general_description: detail.general_description || '',
            city: detail.city || '',
            full_address: detail.full_address || '',
            lat: detail.lat != null ? String(detail.lat) : '',
            lng: detail.lng != null ? String(detail.lng) : '',
            estimated_daily_impressions: detail.estimated_daily_impressions || '',
            price_per_day: detail.price_per_day != null ? String(detail.price_per_day) : '',
            space_type_id: detail.space_type ? String(detail.space_type.id) : '',
            audience_profile_ids: (detail.audience_profiles || []).map(ap => ap.id),
            environment: detail.environment || '',
            average_dwell_time: detail.average_dwell_time != null ? String(detail.average_dwell_time) : '',
            partner_owner: detail.partner_owner ? String(detail.partner_owner) : '',
          });
          setImages(detail.images || []);

          // Populate Hebrew translations if available
          if (translations.he) {
            setHeTranslations({
              name: translations.he.name || '',
              general_description: translations.he.general_description || '',
              city: translations.he.city || '',
              full_address: translations.he.full_address || '',
            });
          }

          // Build weekly grid from existing operating hours
          const week = defaultWeek.map(d => ({ ...d }));
          for (const oh of detail.operating_hours || []) {
            const day = oh.day_of_week;
            if (day >= 0 && day < 7) {
              week[day] = {
                enabled: true,
                start_time: oh.start_time.slice(0, 5),
                end_time: oh.end_time.slice(0, 5),
                existingId: oh.id,
              };
            }
          }
          setWeekHours(week);
          setHoursLoaded(true);

          // Populate screens from existing data (with Hebrew translations)
          if (detail.screens && detail.screens.length > 0) {
            setScreens(detail.screens.map((s: Screen) => {
              const heTrans = screenTrans[s.id]?.he || {};
              return {
                existingId: s.id,
                name: s.name || '',
                name_he: heTrans.name || '',
                size_inches: s.size_inches,
                resolution_width: String(s.resolution_width),
                resolution_height: String(s.resolution_height),
                position_description: s.position_description || '',
                position_description_he: heTrans.position_description || '',
                is_active: s.is_active,
              };
            }));
          }
          setScreensLoaded(true);
        })
        .catch(() => setError(t('failedLoadSpace')))
        .finally(() => setLoading(false));
    }
  }, [id, isEdit]);

  // Cleanup preview URLs
  useEffect(() => {
    return () => {
      pendingImages.forEach(p => URL.revokeObjectURL(p.preview));
    };
  }, [pendingImages]);

  // Section observer for sidebar highlight
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0.1 }
    );
    const sections = document.querySelectorAll('.ase-section[id]');
    sections.forEach(s => observer.observe(s));
    return () => observer.disconnect();
  }, [loading]);

  function validateFile(file: File): string | null {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return t('unsupportedFormat', { name: file.name });
    if (file.size > MAX_FILE_SIZE) return t('fileTooLarge', { name: file.name });
    return null;
  }

  function addFiles(files: FileList | File[]) {
    const errors: string[] = [];
    const newPending: PendingImage[] = [];
    for (const file of Array.from(files)) {
      const err = validateFile(file);
      if (err) { errors.push(err); continue; }
      newPending.push({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file) });
    }
    if (errors.length) modal.alert({ title: t('error', { ns: 'common' }), message: errors.join('\n') });
    if (newPending.length) setPendingImages(prev => [...prev, ...newPending]);
  }

  function removePendingImage(pid: string) {
    setPendingImages(prev => {
      const item = prev.find(p => p.id === pid);
      if (item) URL.revokeObjectURL(item.preview);
      return prev.filter(p => p.id !== pid);
    });
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) {
      if (isEdit) {
        handleDirectUpload(e.target.files);
      } else {
        addFiles(e.target.files);
      }
    }
    e.target.value = '';
  }

  async function handleDirectUpload(files: FileList) {
    if (!id) return;
    for (const file of Array.from(files)) {
      const err = validateFile(file);
      if (err) { await modal.alert({ title: t('error', { ns: 'common' }), message: err }); continue; }
      setUploading(true);
      try {
        const newImage = await uploadSpaceImage(Number(id), file);
        setImages(prev => [...prev, newImage]);
      } catch {
        await modal.alert({ title: t('error', { ns: 'common' }), message: t('failedUpload', { name: file.name }) });
      } finally {
        setUploading(false);
      }
    }
  }

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(false); }, []);
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) {
      if (isEdit) handleDirectUpload(e.dataTransfer.files);
      else addFiles(e.dataTransfer.files);
    }
  }

  async function handleImageDelete(imageId: number) {
    if (!await modal.confirm({ title: t('deleteImage'), message: t('deleteImageConfirm'), variant: 'danger' })) return;
    try {
      await deleteSpaceImage(imageId);
      setImages(prev => prev.filter(img => img.id !== imageId));
    } catch {
      await modal.alert({ title: t('error', { ns: 'common' }), message: t('failedDeleteImage') });
    }
  }

  function updateDayHours(dayIndex: number, field: keyof DayHours, value: string | boolean) {
    setWeekHours(prev => prev.map((d, i) => i === dayIndex ? { ...d, [field]: value } : d));
  }

  function applyToAll(dayIndex: number) {
    const source = weekHours[dayIndex];
    setWeekHours(prev => prev.map((d, i) => {
      if (i === dayIndex) return d;
      if (!d.enabled) return d;
      return { ...d, start_time: source.start_time, end_time: source.end_time };
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    // Validate screens
    for (let i = 0; i < screens.length; i++) {
      const s = screens[i];
      if (!s.size_inches || !s.resolution_width || !s.resolution_height) {
        setError(t('screenFieldsRequired', { num: i + 1 }));
        return;
      }
      if (isNaN(Number(s.resolution_width)) || isNaN(Number(s.resolution_height))) {
        setError(t('screenResolutionNumeric', { num: i + 1 }));
        return;
      }
    }

    setSaving(true);

    const payload: Record<string, unknown> = {};
    if (form.name) payload.name = form.name;
    if (form.general_description) payload.general_description = form.general_description;
    if (form.city) payload.city = form.city;
    if (form.full_address) payload.full_address = form.full_address;
    if (form.lat) payload.lat = parseFloat(form.lat);
    if (form.lng) payload.lng = parseFloat(form.lng);
    if (form.estimated_daily_impressions) payload.estimated_daily_impressions = form.estimated_daily_impressions;
    if (form.price_per_day) payload.price_per_day = parseFloat(form.price_per_day);
    if (form.space_type_id) payload.space_type_id = parseInt(form.space_type_id);
    payload.audience_profile_ids = form.audience_profile_ids;
    if (form.environment) payload.environment = form.environment;
    if (form.average_dwell_time) payload.average_dwell_time = parseInt(form.average_dwell_time);
    if (form.partner_owner) payload.partner_owner = parseInt(form.partner_owner);
    else payload.partner_owner = null;

    // Include Hebrew translations (only non-empty fields)
    const heFields: Record<string, string> = {};
    if (heTranslations.name) heFields.name = heTranslations.name;
    if (heTranslations.general_description) heFields.general_description = heTranslations.general_description;
    if (heTranslations.city) heFields.city = heTranslations.city;
    if (heTranslations.full_address) heFields.full_address = heTranslations.full_address;
    if (Object.keys(heFields).length > 0) {
      payload.translations = { he: heFields };
    }

    try {
      let spaceId: number;
      if (isEdit && id) {
        await updateAdminSpace(Number(id), payload);
        spaceId = Number(id);
      } else {
        const created = await createAdminSpace(payload);
        spaceId = created.id;
      }

      // Upload pending images
      for (const pending of pendingImages) {
        try { await uploadSpaceImage(spaceId, pending.file); } catch { /* continue */ }
      }

      // Sync operating hours
      await syncOperatingHours(spaceId);

      // Sync screens
      await syncScreens(spaceId);

      setPendingImages([]);
      navigate('/admin/spaces');
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : t('failedSaveSpace'));
    } finally {
      setSaving(false);
    }
  }

  async function syncOperatingHours(spaceId: number) {
    // For edit mode: delete removed hours, add new ones, update changed ones
    if (isEdit && hoursLoaded) {
      for (let day = 0; day < 7; day++) {
        const hours = weekHours[day];
        if (hours.existingId && !hours.enabled) {
          // Was enabled, now disabled — delete
          try { await deleteOperatingHours(hours.existingId); } catch { /* continue */ }
        } else if (hours.existingId && hours.enabled) {
          // Existed and still enabled — delete and re-create (simpler than update endpoint)
          try {
            await deleteOperatingHours(hours.existingId);
            await addOperatingHours(spaceId, { day_of_week: day, start_time: hours.start_time, end_time: hours.end_time });
          } catch { /* continue */ }
        } else if (!hours.existingId && hours.enabled) {
          // New entry
          try { await addOperatingHours(spaceId, { day_of_week: day, start_time: hours.start_time, end_time: hours.end_time }); } catch { /* continue */ }
        }
      }
    } else {
      // Create mode — just add all enabled hours
      for (let day = 0; day < 7; day++) {
        const hours = weekHours[day];
        if (hours.enabled) {
          try { await addOperatingHours(spaceId, { day_of_week: day, start_time: hours.start_time, end_time: hours.end_time }); } catch { /* continue */ }
        }
      }
    }
  }

  async function syncScreens(spaceId: number) {
    const translationsPayload: ScreenTranslations = {};

    if (isEdit && screensLoaded) {
      for (const entry of screens) {
        if (!entry.size_inches || !entry.resolution_width || !entry.resolution_height) continue;
        const data = {
          name: entry.name || undefined,
          size_inches: entry.size_inches,
          resolution_width: Number(entry.resolution_width),
          resolution_height: Number(entry.resolution_height),
          position_description: entry.position_description || undefined,
          is_active: entry.is_active,
        };
        let screenId = entry.existingId;
        if (screenId) {
          try { await updateScreen(screenId, data); } catch { /* continue */ }
        } else {
          try {
            const created = await addScreen(spaceId, data);
            screenId = created.id;
          } catch { continue; }
        }
        // Collect Hebrew translations
        if (screenId) {
          const heFields: Record<string, string> = {};
          if (entry.name_he) heFields.name = entry.name_he;
          if (entry.position_description_he) heFields.position_description = entry.position_description_he;
          // Always send entry so empty values clear old translations
          translationsPayload[screenId] = { he: {
            name: entry.name_he || '',
            position_description: entry.position_description_he || '',
          }};
        }
      }
    } else {
      for (const entry of screens) {
        if (!entry.size_inches || !entry.resolution_width || !entry.resolution_height) continue;
        try {
          const created = await addScreen(spaceId, {
            name: entry.name || undefined,
            size_inches: entry.size_inches,
            resolution_width: Number(entry.resolution_width),
            resolution_height: Number(entry.resolution_height),
            position_description: entry.position_description || undefined,
            is_active: entry.is_active,
          });
          if (entry.name_he || entry.position_description_he) {
            translationsPayload[created.id] = { he: {
              name: entry.name_he || '',
              position_description: entry.position_description_he || '',
            }};
          }
        } catch { /* continue */ }
      }
    }

    // Save all screen translations in one call
    if (Object.keys(translationsPayload).length > 0) {
      try { await setScreenTranslations(translationsPayload); } catch { /* continue */ }
    }
  }

  function addScreenEntry() {
    setScreens(prev => [...prev, {
      name: '',
      name_he: '',
      size_inches: '',
      resolution_width: '',
      resolution_height: '',
      position_description: '',
      position_description_he: '',
      is_active: true,
    }]);
  }

  function updateScreenEntry(index: number, field: keyof ScreenEntry, value: string | boolean) {
    setScreens(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  }

  async function removeScreenEntry(index: number) {
    const entry = screens[index];
    if (entry.existingId) {
      if (!await modal.confirm({ title: t('deleteScreen'), message: t('deleteScreenConfirm'), variant: 'danger' })) return;
      try {
        await deleteScreen(entry.existingId);
      } catch {
        await modal.alert({ title: t('error', { ns: 'common' }), message: t('failedDeleteScreen') });
        return;
      }
    }
    setScreens(prev => prev.filter((_, i) => i !== index));
  }

  const heIncomplete = !heTranslations.name || !heTranslations.city;

  const SECTIONS = [
    { id: 'translations', label: t('sidebarTranslations') },
    { id: 'basic', label: t('sidebarBasicInfo') },
    { id: 'location', label: t('sidebarLocation') },
    { id: 'details', label: t('sidebarDetails') },
    { id: 'screens', label: t('sidebarScreens') },
    { id: 'audience', label: t('sidebarAudience') },
    { id: 'images', label: t('sidebarImages') },
    { id: 'hours', label: t('sidebarHours') },
  ];

  if (loading) return <Loader variant="page" />;

  const enabledDays = weekHours.filter(d => d.enabled).length;

  return (
    <div className="ase-page">
      {/* Top bar */}
      <div className="ase-topbar">
        <div className="ase-topbar-left">
          <Link to="/admin/spaces" className="ase-back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
          </Link>
          <h1>{isEdit ? t('editSpace') : t('newSpaceTitle')}</h1>
        </div>
        <div className="ase-topbar-right">
          <Link to="/admin/spaces" className="ase-btn-cancel">{t('cancel', { ns: 'common' })}</Link>
          <button onClick={handleSubmit} className="ase-btn-save" disabled={saving}>
            {saving ? <><Loader variant="button" className="loader-light" /> {t('saving', { ns: 'common' })}</> : isEdit ? t('saveChanges') : t('createSpace')}
          </button>
        </div>
      </div>

      {error && <div className="ase-error">{error}</div>}

      <div className="ase-layout">
        {/* Sidebar nav */}
        <nav className="ase-sidebar">
          {SECTIONS.map(s => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={`ase-sidebar-link${activeSection === s.id ? ' active' : ''}`}
              onClick={e => {
                e.preventDefault();
                document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              {s.label}
            </a>
          ))}
        </nav>

        {/* Main form */}
        <form className="ase-form" onSubmit={handleSubmit}>
          {/* Language Tabs */}
          <section className="ase-section" id="translations">
            <div className="ase-lang-tabs">
              <button
                type="button"
                className={`ase-lang-tab${activeLang === 'en' ? ' active' : ''}`}
                onClick={() => setActiveLang('en')}
              >
                English
              </button>
              <button
                type="button"
                className={`ase-lang-tab${activeLang === 'he' ? ' active' : ''}`}
                onClick={() => setActiveLang('he')}
              >
                {t('hebrew')}{heIncomplete ? ' (\u26A0)' : ''}
              </button>
            </div>
            {activeLang === 'he' && (
              <div className="ase-lang-info">{t('hebrewTranslationInfo')}</div>
            )}
          </section>

          {/* Basic Info */}
          <section className="ase-section" id="basic">
            <div className="ase-section-header">
              <h2>{t('basicInfo')}</h2>
              <p>{t('basicInfoDesc')}</p>
            </div>
            <div className="ase-field-grid">
              <div className="ase-field span-2">
                <label>{t('spaceName')}</label>
                {activeLang === 'he' ? (
                  <input dir="rtl" value={heTranslations.name} onChange={e => setHeTranslations({ ...heTranslations, name: e.target.value })} placeholder={form.name || t('spaceNamePlaceholder')} />
                ) : (
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required={!isEdit} placeholder={t('spaceNamePlaceholder')} />
                )}
              </div>
              <div className="ase-field">
                <label>{t('pricePerDayLabel')}</label>
                <div className="ase-input-prefix">
                  <span>&#8362;</span>
                  <input type="number" step="0.01" value={form.price_per_day} onChange={e => setForm({ ...form, price_per_day: e.target.value })} required={!isEdit} placeholder="0.00" />
                </div>
              </div>
              <div className="ase-field">
                <label>{t('environmentLabel')}</label>
                <select value={form.environment} onChange={e => setForm({ ...form, environment: e.target.value })}>
                  <option value="">{t('selectEnvironment')}</option>
                  <option value="indoor">{t('indoor', { ns: 'common' })}</option>
                  <option value="outdoor">{t('outdoor', { ns: 'common' })}</option>
                </select>
              </div>
              <div className="ase-field span-2">
                <label>{t('partnerOwner')}</label>
                <select value={form.partner_owner} onChange={e => setForm({ ...form, partner_owner: e.target.value })}>
                  <option value="">{t('noPartner')}</option>
                  {partners.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.email})</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Location */}
          <section className="ase-section" id="location">
            <div className="ase-section-header">
              <h2>{t('locationSection')}</h2>
              <p>{t('locationDesc')}</p>
            </div>
            <div className="ase-field-grid">
              <div className="ase-field">
                <label>{t('city')}</label>
                {activeLang === 'he' ? (
                  <input dir="rtl" value={heTranslations.city} onChange={e => setHeTranslations({ ...heTranslations, city: e.target.value })} placeholder={form.city || t('cityPlaceholder')} />
                ) : (
                  <input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} placeholder={t('cityPlaceholder')} />
                )}
              </div>
              <div className="ase-field">
                <label>{t('fullAddress')}</label>
                {activeLang === 'he' ? (
                  <input dir="rtl" value={heTranslations.full_address} onChange={e => setHeTranslations({ ...heTranslations, full_address: e.target.value })} placeholder={form.full_address || t('addressPlaceholder')} />
                ) : (
                  <input value={form.full_address} onChange={e => setForm({ ...form, full_address: e.target.value })} placeholder={t('addressPlaceholder')} />
                )}
              </div>
              <div className="ase-field">
                <label>{t('latitude')}</label>
                <input type="number" step="any" value={form.lat} onChange={e => setForm({ ...form, lat: e.target.value })} placeholder="32.0853" />
              </div>
              <div className="ase-field">
                <label>{t('longitude')}</label>
                <input type="number" step="any" value={form.lng} onChange={e => setForm({ ...form, lng: e.target.value })} placeholder="34.7818" />
              </div>
            </div>
          </section>

          {/* Space Details */}
          <section className="ase-section" id="details">
            <div className="ase-section-header">
              <h2>{t('spaceDetails')}</h2>
              <p>{t('spaceDetailsDesc')}</p>
            </div>
            <div className="ase-field-grid">
              <div className="ase-field span-2">
                <label>{t('spaceType')}</label>
                <select value={form.space_type_id} onChange={e => setForm({ ...form, space_type_id: e.target.value })}>
                  <option value="">{t('selectType')}</option>
                  {spaceTypes.map(st => (
                    <option key={st.id} value={st.id}>{st.name}</option>
                  ))}
                </select>
              </div>
              <div className="ase-field">
                <label>{t('dailyImpressions')}</label>
                <input type="text" value={form.estimated_daily_impressions} onChange={e => setForm({ ...form, estimated_daily_impressions: e.target.value })} placeholder={t('impressionsPlaceholder')} />
              </div>
              <div className="ase-field">
                <label>{t('avgDwellTime')}</label>
                <input type="number" value={form.average_dwell_time} onChange={e => setForm({ ...form, average_dwell_time: e.target.value })} placeholder={t('dwellTimePlaceholder')} />
              </div>
              <div className="ase-field span-full">
                <label>{t('description')}</label>
                {activeLang === 'he' ? (
                  <textarea dir="rtl" value={heTranslations.general_description} onChange={e => setHeTranslations({ ...heTranslations, general_description: e.target.value })} rows={4} placeholder={form.general_description || t('descriptionPlaceholder')} />
                ) : (
                  <textarea value={form.general_description} onChange={e => setForm({ ...form, general_description: e.target.value })} rows={4} placeholder={t('descriptionPlaceholder')} />
                )}
              </div>
            </div>
          </section>

          {/* Screens */}
          <section className="ase-section" id="screens">
            <div className="ase-section-header">
              <h2>{t('screensSection')}</h2>
              <p>{t('screensSectionDesc')}</p>
            </div>
            {screens.length === 0 && (
              <p className="ase-hint">{t('noScreensAdded')}</p>
            )}
            <div className="ase-screens-list">
              {screens.map((screen, idx) => (
                <div key={idx} className={`ase-screen-card${screen.is_active ? '' : ' inactive'}`}>
                  <div className="ase-screen-header">
                    <span className="ase-screen-number">{screen.name || t('screenNumber', { num: idx + 1 })}</span>
                    <div className="ase-screen-actions">
                      <label className="ase-hours-toggle">
                        <input
                          type="checkbox"
                          checked={screen.is_active}
                          onChange={e => updateScreenEntry(idx, 'is_active', e.target.checked)}
                        />
                        <span className="ase-hours-toggle-track">
                          <span className="ase-hours-toggle-thumb" />
                        </span>
                        <span>{t('active')}</span>
                      </label>
                      <button type="button" className="ase-screen-delete" onClick={() => removeScreenEntry(idx)} title={t('deleteScreenConfirm')}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                      </button>
                    </div>
                  </div>
                  <div className="ase-field-grid">
                    <div className="ase-field">
                      <label>{t('screenName')}</label>
                      {activeLang === 'he' ? (
                        <input dir="rtl" value={screen.name_he} onChange={e => updateScreenEntry(idx, 'name_he', e.target.value)} placeholder={screen.name || t('screenNamePlaceholder')} />
                      ) : (
                        <input value={screen.name} onChange={e => updateScreenEntry(idx, 'name', e.target.value)} placeholder={t('screenNamePlaceholder')} />
                      )}
                    </div>
                    <div className="ase-field">
                      <label>{t('screenSizeInches')}</label>
                      <input value={screen.size_inches} onChange={e => updateScreenEntry(idx, 'size_inches', e.target.value)} placeholder={t('screenSizeInchesPlaceholder')} />
                    </div>
                    <div className="ase-field">
                      <label>{t('resolutionWidth')}</label>
                      <input type="number" value={screen.resolution_width} onChange={e => updateScreenEntry(idx, 'resolution_width', e.target.value)} placeholder={t('resolutionWidthPlaceholder')} />
                    </div>
                    <div className="ase-field">
                      <label>{t('resolutionHeight')}</label>
                      <input type="number" value={screen.resolution_height} onChange={e => updateScreenEntry(idx, 'resolution_height', e.target.value)} placeholder={t('resolutionHeightPlaceholder')} />
                    </div>
                    <div className="ase-field">
                      <label>{t('positionDescription')}</label>
                      {activeLang === 'he' ? (
                        <input dir="rtl" value={screen.position_description_he} onChange={e => updateScreenEntry(idx, 'position_description_he', e.target.value)} placeholder={screen.position_description || t('positionDescriptionPlaceholder')} />
                      ) : (
                        <input value={screen.position_description} onChange={e => updateScreenEntry(idx, 'position_description', e.target.value)} placeholder={t('positionDescriptionPlaceholder')} />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" className="ase-screen-add" onClick={addScreenEntry}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              {t('addScreen')}
            </button>
            <div className="ase-hours-summary">
              {screens.length === 0 ? t('noScreensConfigured') : t('screensCount', { count: screens.length })}
            </div>
          </section>

          {/* Audience */}
          <section className="ase-section" id="audience">
            <div className="ase-section-header">
              <h2>{t('audienceProfiles')}</h2>
              <p>{t('audienceDesc')}</p>
            </div>
            <div className="ase-audience-groups">
              {([
                { key: 'Demographic', label: t('demographic', { ns: 'common' }) },
                { key: 'Lifestyle', label: t('lifestyle', { ns: 'common' }) },
                { key: 'Behavior / Context', label: t('behaviorContext', { ns: 'common' }) },
              ] as const).map(cat => {
                const catProfiles = audienceProfiles.filter(ap => ap.category === cat.key);
                if (catProfiles.length === 0) return null;
                return (
                  <div key={cat.key} className="ase-audience-group">
                    <div className="ase-audience-group-label">{cat.label}</div>
                    <div className="ase-audience-chips">
                      {catProfiles.map(ap => (
                        <button
                          key={ap.id}
                          type="button"
                          className={`ase-audience-chip${form.audience_profile_ids.includes(ap.id) ? ' selected' : ''}`}
                          onClick={() => {
                            setForm(prev => ({
                              ...prev,
                              audience_profile_ids: prev.audience_profile_ids.includes(ap.id)
                                ? prev.audience_profile_ids.filter(x => x !== ap.id)
                                : [...prev.audience_profile_ids, ap.id],
                            }));
                          }}
                        >
                          {form.audience_profile_ids.includes(ap.id) && (
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          )}
                          {ap.name}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            {form.audience_profile_ids.length > 0 && (
              <div className="ase-audience-summary">
                {t('profilesSelected', { count: form.audience_profile_ids.length })}
                <button type="button" className="ase-audience-clear" onClick={() => setForm(prev => ({ ...prev, audience_profile_ids: [] }))}>
                  {t('clearAll', { ns: 'common' })}
                </button>
              </div>
            )}
          </section>

          {/* Images */}
          <section className="ase-section" id="images">
            <div className="ase-section-header">
              <h2>{t('images')}</h2>
              <p>{t('imagesDesc')}</p>
            </div>
            <div className="ase-images-grid">
              {images.map((img, i) => (
                <div key={img.id} className={`ase-image-card${i === 0 ? ' cover' : ''}`}>
                  <img src={`${API_URL}${img.image_url}`} alt="" />
                  {i === 0 && <span className="ase-image-cover-badge">{t('cover')}</span>}
                  <button type="button" className="ase-image-remove" onClick={() => handleImageDelete(img.id)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              ))}
              {pendingImages.map(p => (
                <div key={p.id} className="ase-image-card pending">
                  <img src={p.preview} alt="" />
                  <span className="ase-image-pending-label">{t('pendingUpload')}</span>
                  <button type="button" className="ase-image-remove" onClick={() => removePendingImage(p.id)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              ))}
              <label
                className={`ase-image-upload${dragOver ? ' drag-over' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  multiple
                  onChange={handleFileInput}
                  disabled={uploading}
                />
                <div className="ase-image-upload-content">
                  {uploading ? (
                    <Loader variant="inline" />
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="32" height="32"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                      <span className="ase-upload-text">{t('uploadImages')}</span>
                      <span className="ase-upload-hint">{t('dragDrop')}</span>
                    </>
                  )}
                </div>
              </label>
            </div>
            <p className="ase-hint">{t('imageFormats')}{!isEdit && pendingImages.length > 0 ? ` \u2014 ${t('queuedForUpload', { count: pendingImages.length })}` : ''}</p>
          </section>

          {/* Operating Hours */}
          <section className="ase-section" id="hours">
            <div className="ase-section-header">
              <h2>{t('operatingHours')}</h2>
              <p>{t('hoursDesc')}</p>
            </div>
            <div className="ase-hours-grid">
              {weekHours.map((day, i) => (
                <div key={i} className={`ase-hours-row${day.enabled ? ' enabled' : ''}`}>
                  <label className="ase-hours-toggle">
                    <input
                      type="checkbox"
                      checked={day.enabled}
                      onChange={e => updateDayHours(i, 'enabled', e.target.checked)}
                    />
                    <span className="ase-hours-toggle-track">
                      <span className="ase-hours-toggle-thumb" />
                    </span>
                    <span className="ase-hours-day-name">{DAY_NAMES[i]}</span>
                    <span className="ase-hours-day-short">{DAY_SHORT[i]}</span>
                  </label>
                  {day.enabled ? (
                    <div className="ase-hours-times">
                      <input
                        type="time"
                        value={day.start_time}
                        onChange={e => updateDayHours(i, 'start_time', e.target.value)}
                      />
                      <span className="ase-hours-separator">{t('to', { ns: 'common' })}</span>
                      <input
                        type="time"
                        value={day.end_time}
                        onChange={e => updateDayHours(i, 'end_time', e.target.value)}
                      />
                      <button type="button" className="ase-hours-apply" onClick={() => applyToAll(i)} title={t('applyToAllDays')}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
                      </button>
                    </div>
                  ) : (
                    <span className="ase-hours-closed">{t('closed', { ns: 'common' })}</span>
                  )}
                </div>
              ))}
            </div>
            <div className="ase-hours-summary">
              {enabledDays === 0 ? t('noHoursSet') : t('openDays', { count: enabledDays })}
            </div>
          </section>

          {/* Bottom actions (mobile) */}
          <div className="ase-bottom-actions">
            <Link to="/admin/spaces" className="ase-btn-cancel">{t('cancel', { ns: 'common' })}</Link>
            <button type="submit" className="ase-btn-save" disabled={saving}>
              {saving ? <><Loader variant="button" className="loader-light" /> {t('saving', { ns: 'common' })}</> : isEdit ? t('saveChanges') : t('createSpace')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
