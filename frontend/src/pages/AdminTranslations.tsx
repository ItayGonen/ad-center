import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import api from '../services/api';
import Loader from '../components/Loader';
import { getSpaceTypes, getAudienceProfiles } from '../services/spaces';
import type { SpaceTypeItem, AudienceProfile } from '../services/spaces';
import {
  getSpaceTypeTranslations, setSpaceTypeTranslations,
  getAudienceProfileTranslations, setAudienceProfileTranslations,
  createSpaceType, deleteSpaceType,
  createAudienceProfile, deleteAudienceProfile,
} from '../services/admin';
import type { ItemTranslations } from '../services/admin';
import { useModal } from '../context/ModalContext';

// Bundled locale files (source of truth for keys)
import enCommon from '../locales/en/common.json';
import enAuth from '../locales/en/auth.json';
import enSpaces from '../locales/en/spaces.json';
import enOrders from '../locales/en/orders.json';
import enSettings from '../locales/en/settings.json';
import enAdmin from '../locales/en/admin.json';
import heCommon from '../locales/he/common.json';
import heAuth from '../locales/he/auth.json';
import heSpaces from '../locales/he/spaces.json';
import heOrders from '../locales/he/orders.json';
import heSettings from '../locales/he/settings.json';
import heAdmin from '../locales/he/admin.json';

const NAMESPACES = ['common', 'auth', 'spaces', 'orders', 'settings', 'admin'];

const BUNDLED: Record<string, { en: Record<string, string>; he: Record<string, string> }> = {
  common:   { en: enCommon   as Record<string, string>, he: heCommon   as Record<string, string> },
  auth:     { en: enAuth     as Record<string, string>, he: heAuth     as Record<string, string> },
  spaces:   { en: enSpaces   as Record<string, string>, he: heSpaces   as Record<string, string> },
  orders:   { en: enOrders   as Record<string, string>, he: heOrders   as Record<string, string> },
  settings: { en: enSettings as Record<string, string>, he: heSettings as Record<string, string> },
  admin:    { en: enAdmin    as Record<string, string>, he: heAdmin    as Record<string, string> },
};

interface TranslationEntry {
  [lang: string]: string;
}

interface TranslationData {
  [key: string]: TranslationEntry;
}

const adminTabs = [
  { id: 'users', path: '/admin/users' },
  { id: 'spaces', path: '/admin/spaces' },
  { id: 'orders', path: '/admin/orders' },
  { id: 'calendar', path: '/admin/calendar' },
  { id: 'notifications', path: '/admin/notifications' },
  { id: 'translations', path: '/admin/translations' },
  { id: 'settings', path: '/admin/settings' },
];

type ContentTab = 'ui' | 'spaceTypes' | 'audienceProfiles';

export default function AdminTranslations() {
  const { t } = useTranslation('admin');
  const modal = useModal();
  const [contentTab, setContentTab] = useState<ContentTab>('ui');
  const [activeNs, setActiveNs] = useState('common');
  const [dbData, setDbData] = useState<Record<string, TranslationData>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  // Track pending edits: { "ns:key:lang": value }
  const [pendingEdits, setPendingEdits] = useState<Record<string, string>>({});
  const [savingAll, setSavingAll] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const hasPendingEdits = Object.keys(pendingEdits).length > 0;

  const trackEdit = (ns: string, key: string, lang: string, value: string) => {
    const editKey = `${ns}:${key}:${lang}`;
    const original = mergedNsData[key]?.[lang];
    const originalStr = typeof original === 'string' ? original : '';
    setPendingEdits(prev => {
      const next = { ...prev };
      if (value === originalStr) {
        delete next[editKey];
      } else {
        next[editKey] = value;
      }
      return next;
    });
  };

  async function handleSaveAll() {
    if (!hasPendingEdits) return;
    setSavingAll(true);
    setSaveSuccess(false);
    try {
      const promises = Object.entries(pendingEdits).map(([editKey, value]) => {
        const [ns, key, lang] = editKey.split(':');
        return api.put('/translations/ui', { namespace: ns, key, language: lang, value }).then(() => {
          setDbData(prev => {
            const next = { ...prev };
            if (!next[ns]) next[ns] = {};
            next[ns] = { ...next[ns], [key]: { ...next[ns][key], [lang]: value } };
            return next;
          });
        });
      });
      await Promise.all(promises);
      setPendingEdits({});
      // Reload i18next resources so changes reflect in the UI immediately
      await i18n.reloadResources();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch {
      // partial failure — keep remaining edits
    } finally {
      setSavingAll(false);
    }
  }

  // Space types / audience profiles state
  const [spaceTypes, setSpaceTypes] = useState<SpaceTypeItem[]>([]);
  const [spaceTypeTrans, setSpaceTypeTrans] = useState<Record<number, string>>({});
  const [audienceProfiles, setAudienceProfiles] = useState<AudienceProfile[]>([]);
  const [audienceProfileTrans, setAudienceProfileTrans] = useState<Record<number, string>>({});
  const [contentLoading, setContentLoading] = useState(false);
  const [contentSaving, setContentSaving] = useState(false);

  // Add-form state
  const [newSpaceType, setNewSpaceType] = useState({ name: '', nameHe: '' });
  const [newAudienceProfile, setNewAudienceProfile] = useState({ name: '', nameHe: '', category: '' });
  const [adding, setAdding] = useState(false);

  const AUDIENCE_CATEGORIES = ['Demographic', 'Lifestyle', 'Behavior / Context'];

  const fetchData = useCallback(() => {
    setLoading(true);
    api.get('/translations/ui')
      .then(res => { setDbData(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Merge bundled JSON + DB overrides for the active namespace
  const mergedNsData = useMemo(() => {
    const bundled = BUNDLED[activeNs];
    if (!bundled) return {};
    const dbNs = dbData[activeNs] || {};

    // Collect all keys from both bundled EN and HE files + DB
    const allKeys = new Set([
      ...Object.keys(bundled.en),
      ...Object.keys(bundled.he),
      ...Object.keys(dbNs),
    ]);

    const merged: TranslationData = {};
    for (const key of allKeys) {
      merged[key] = {
        en: dbNs[key]?.en || bundled.en[key] || '',
        he: dbNs[key]?.he || bundled.he[key] || '',
      };
    }
    return merged;
  }, [activeNs, dbData]);

  // Load content translations when switching to those tabs
  useEffect(() => {
    if (contentTab === 'spaceTypes') {
      setContentLoading(true);
      Promise.all([
        getSpaceTypes(),
        getSpaceTypeTranslations(),
      ]).then(([types, trans]) => {
        setSpaceTypes(types);
        const heMap: Record<number, string> = {};
        for (const [id, langs] of Object.entries(trans)) {
          const heTrans = (langs as Record<string, Record<string, string>>)?.he;
          if (heTrans?.name) heMap[Number(id)] = heTrans.name;
        }
        setSpaceTypeTrans(heMap);
      }).catch(() => {}).finally(() => setContentLoading(false));
    } else if (contentTab === 'audienceProfiles') {
      setContentLoading(true);
      Promise.all([
        getAudienceProfiles(),
        getAudienceProfileTranslations(),
      ]).then(([profiles, trans]) => {
        setAudienceProfiles(profiles);
        const heMap: Record<number, string> = {};
        for (const [id, langs] of Object.entries(trans)) {
          const heTrans = (langs as Record<string, Record<string, string>>)?.he;
          if (heTrans?.name) heMap[Number(id)] = heTrans.name;
        }
        setAudienceProfileTrans(heMap);
      }).catch(() => {}).finally(() => setContentLoading(false));
    }
  }, [contentTab]);

  const keys = Object.keys(mergedNsData).filter(k => {
    // Skip non-string values (e.g. arrays like dayNames)
    const en = mergedNsData[k]?.en;
    const he = mergedNsData[k]?.he;
    if (typeof en !== 'string' && typeof he !== 'string') return false;
    if (!search) return true;
    const q = search.toLowerCase();
    const enStr = typeof en === 'string' ? en : '';
    const heStr = typeof he === 'string' ? he : '';
    return k.toLowerCase().includes(q) || enStr.toLowerCase().includes(q) || heStr.toLowerCase().includes(q);
  }).sort();

  async function handleSave(key: string, lang: string, value: string) {
    setSavingKey(`${key}-${lang}`);
    try {
      await api.put('/translations/ui', {
        namespace: activeNs,
        key,
        language: lang,
        value,
      });
      // Update local DB data so the merge stays in sync
      setDbData(prev => {
        const next = { ...prev };
        if (!next[activeNs]) next[activeNs] = {};
        if (!next[activeNs][key]) next[activeNs][key] = {};
        next[activeNs] = { ...next[activeNs], [key]: { ...next[activeNs][key], [lang]: value } };
        return next;
      });
    } catch {
      // silently fail
    } finally {
      setSavingKey(null);
    }
  }

  async function handleSaveSpaceTypes() {
    setContentSaving(true);
    try {
      const payload: ItemTranslations = {};
      for (const [id, value] of Object.entries(spaceTypeTrans)) {
        payload[Number(id)] = { he: value };
      }
      await setSpaceTypeTranslations(payload);
    } catch {
      // silently fail
    } finally {
      setContentSaving(false);
    }
  }

  async function handleSaveAudienceProfiles() {
    setContentSaving(true);
    try {
      const payload: ItemTranslations = {};
      for (const [id, value] of Object.entries(audienceProfileTrans)) {
        payload[Number(id)] = { he: value };
      }
      await setAudienceProfileTranslations(payload);
    } catch {
      // silently fail
    } finally {
      setContentSaving(false);
    }
  }

  async function handleAddSpaceType() {
    if (!newSpaceType.name.trim() || !newSpaceType.nameHe.trim()) return;
    setAdding(true);
    try {
      const created = await createSpaceType(newSpaceType.name, newSpaceType.nameHe);
      setSpaceTypes(prev => [...prev, created]);
      setSpaceTypeTrans(prev => ({ ...prev, [created.id]: newSpaceType.nameHe }));
      setNewSpaceType({ name: '', nameHe: '' });
    } catch {
      // silently fail
    } finally {
      setAdding(false);
    }
  }

  async function handleDeleteSpaceType(id: number) {
    if (!await modal.confirm({ title: t('delete', { ns: 'common' }), message: t('deleteConfirm'), variant: 'danger' })) return;
    try {
      await deleteSpaceType(id);
      setSpaceTypes(prev => prev.filter(st => st.id !== id));
      setSpaceTypeTrans(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch {
      // silently fail
    }
  }

  async function handleAddAudienceProfile() {
    if (!newAudienceProfile.name.trim() || !newAudienceProfile.nameHe.trim() || !newAudienceProfile.category) return;
    setAdding(true);
    try {
      const created = await createAudienceProfile(newAudienceProfile.name, newAudienceProfile.nameHe, newAudienceProfile.category);
      setAudienceProfiles(prev => [...prev, created]);
      setAudienceProfileTrans(prev => ({ ...prev, [created.id]: newAudienceProfile.nameHe }));
      setNewAudienceProfile({ name: '', nameHe: '', category: '' });
    } catch {
      // silently fail
    } finally {
      setAdding(false);
    }
  }

  async function handleDeleteAudienceProfile(id: number) {
    if (!await modal.confirm({ title: t('delete', { ns: 'common' }), message: t('deleteConfirm'), variant: 'danger' })) return;
    try {
      await deleteAudienceProfile(id);
      setAudienceProfiles(prev => prev.filter(ap => ap.id !== id));
      setAudienceProfileTrans(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch {
      // silently fail
    }
  }

  const inputStyle = {
    width: '100%',
    padding: '6px 8px',
    border: '1px solid #e5e5e5',
    borderRadius: 6,
    fontSize: 14,
  };

  const missingInputStyle = {
    ...inputStyle,
    border: '1px solid #f59e0b',
    background: '#fffbeb',
  };

  return (
    <div className="admin-page">
      <div className="admin-tabs">
        {adminTabs.map(tab => (
          <Link
            key={tab.id}
            to={tab.path}
            className={`admin-tab${tab.id === 'translations' ? ' active' : ''}`}
          >
            {t(tab.id)}
          </Link>
        ))}
      </div>

      <div className="admin-header">
        <div>
          <h1>{t('translationsTitle')}</h1>
          <p style={{ color: '#888', margin: '4px 0 0' }}>{t('translationsDesc')}</p>
        </div>
      </div>

      {/* Content type tabs */}
      <div className="admin-tabs" style={{ marginBottom: 16 }}>
        <button
          className={`admin-tab${contentTab === 'ui' ? ' active' : ''}`}
          onClick={() => setContentTab('ui')}
          style={{ cursor: 'pointer' }}
        >
          {t('uiStrings')}
        </button>
        <button
          className={`admin-tab${contentTab === 'spaceTypes' ? ' active' : ''}`}
          onClick={() => setContentTab('spaceTypes')}
          style={{ cursor: 'pointer' }}
        >
          {t('spaceTypesTab')}
        </button>
        <button
          className={`admin-tab${contentTab === 'audienceProfiles' ? ' active' : ''}`}
          onClick={() => setContentTab('audienceProfiles')}
          style={{ cursor: 'pointer' }}
        >
          {t('audienceProfilesTab')}
        </button>
      </div>

      {contentTab === 'ui' && (
        <>
          {/* Namespace tabs */}
          <div className="admin-tabs" style={{ marginBottom: 16 }}>
            {NAMESPACES.map(ns => (
              <button
                key={ns}
                className={`admin-tab${activeNs === ns ? ' active' : ''}`}
                onClick={() => setActiveNs(ns)}
                style={{ cursor: 'pointer' }}
              >
                {ns}
              </button>
            ))}
          </div>

          {/* Search */}
          <div style={{ marginBottom: 16 }}>
            <input
              type="text"
              placeholder={t('searchKeys')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, width: '100%', maxWidth: 400 }}
            />
          </div>

          {loading ? (
            <Loader variant="inline" />
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th style={{ width: '30%' }}>{t('key')}</th>
                    <th style={{ width: '35%' }}>{t('english')}</th>
                    <th style={{ width: '35%' }}>{t('hebrew')}</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.length === 0 ? (
                    <tr>
                      <td colSpan={3} style={{ textAlign: 'center', color: '#888', padding: 24 }}>
                        {t('noItemsFound')}
                      </td>
                    </tr>
                  ) : (
                    keys.map(key => {
                      const enVal = typeof mergedNsData[key]?.en === 'string' ? mergedNsData[key].en : '';
                      const heVal = typeof mergedNsData[key]?.he === 'string' ? mergedNsData[key].he : '';
                      const enPending = pendingEdits[`${activeNs}:${key}:en`];
                      const hePending = pendingEdits[`${activeNs}:${key}:he`];
                      return (
                      <tr key={key}>
                        <td><code style={{ fontSize: 13, color: '#555' }}>{key}</code></td>
                        <td>
                          <input
                            type="text"
                            defaultValue={enPending !== undefined ? enPending : enVal}
                            key={`${activeNs}-${key}-en`}
                            onChange={e => trackEdit(activeNs, key, 'en', e.target.value)}
                            style={enPending !== undefined ? { ...inputStyle, border: '1px solid #6c5ce7', background: '#f8f7ff' } : inputStyle}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            defaultValue={hePending !== undefined ? hePending : heVal}
                            key={`${activeNs}-${key}-he`}
                            dir="rtl"
                            onChange={e => trackEdit(activeNs, key, 'he', e.target.value)}
                            style={hePending !== undefined ? { ...inputStyle, border: '1px solid #6c5ce7', background: '#f8f7ff' } : !heVal ? missingInputStyle : inputStyle}
                            placeholder={!heVal ? t('missingTranslation') : ''}
                          />
                        </td>
                      </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Save button */}
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
            {saveSuccess && (
              <span style={{ color: '#16a34a', fontSize: 14, fontWeight: 500 }}>
                {t('savedSuccessfully')}
              </span>
            )}
            <button
              onClick={handleSaveAll}
              disabled={!hasPendingEdits || savingAll}
              className="ase-btn-save"
              style={{ opacity: hasPendingEdits ? 1 : 0.5 }}
            >
              {savingAll
                ? <><Loader variant="button" className="loader-light" /> {t('saving', { ns: 'common' })}</>
                : hasPendingEdits
                  ? `${t('saveChanges')} (${Object.keys(pendingEdits).length})`
                  : t('saveChanges')
              }
            </button>
          </div>
        </>
      )}

      {contentTab === 'spaceTypes' && (
        contentLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>{t('loading', { ns: 'common' })}</div>
        ) : (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th style={{ width: '45%' }}>{t('english')}</th>
                    <th style={{ width: '45%' }}>{t('hebrew')}</th>
                    <th style={{ width: '10%' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {spaceTypes.length === 0 ? (
                    <tr>
                      <td colSpan={3} style={{ textAlign: 'center', color: '#888', padding: 24 }}>
                        {t('noItemsFound')}
                      </td>
                    </tr>
                  ) : (
                    spaceTypes.map(st => (
                      <tr key={st.id}>
                        <td style={{ fontWeight: 500 }}>{st.name}</td>
                        <td>
                          <input
                            type="text"
                            value={spaceTypeTrans[st.id] || ''}
                            dir="rtl"
                            onChange={e => setSpaceTypeTrans(prev => ({ ...prev, [st.id]: e.target.value }))}
                            style={!spaceTypeTrans[st.id] ? missingInputStyle : inputStyle}
                            placeholder={t('missingTranslation')}
                          />
                        </td>
                        <td>
                          <button className="admin-delete-btn" onClick={() => handleDeleteSpaceType(st.id)} title="Delete">
                            🗑
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                  <tr className="admin-add-row">
                    <td>
                      <input
                        type="text"
                        value={newSpaceType.name}
                        onChange={e => setNewSpaceType(prev => ({ ...prev, name: e.target.value }))}
                        placeholder={t('englishName')}
                        style={inputStyle}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={newSpaceType.nameHe}
                        dir="rtl"
                        onChange={e => setNewSpaceType(prev => ({ ...prev, nameHe: e.target.value }))}
                        placeholder={t('hebrewName')}
                        style={inputStyle}
                      />
                    </td>
                    <td>
                      <button
                        className="admin-add-btn"
                        onClick={handleAddSpaceType}
                        disabled={adding || !newSpaceType.name.trim() || !newSpaceType.nameHe.trim()}
                      >
                        {t('add')}
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={handleSaveSpaceTypes}
                disabled={contentSaving}
                className="ase-btn-save"
              >
                {contentSaving ? <><Loader variant="button" className="loader-light" /> {t('saving', { ns: 'common' })}</> : t('saveChanges')}
              </button>
            </div>
          </>
        )
      )}

      {contentTab === 'audienceProfiles' && (
        contentLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>{t('loading', { ns: 'common' })}</div>
        ) : (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th style={{ width: '18%' }}>{t('category')}</th>
                    <th style={{ width: '32%' }}>{t('english')}</th>
                    <th style={{ width: '32%' }}>{t('hebrew')}</th>
                    <th style={{ width: '8%' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {audienceProfiles.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', color: '#888', padding: 24 }}>
                        {t('noItemsFound')}
                      </td>
                    </tr>
                  ) : (
                    audienceProfiles.map(ap => (
                      <tr key={ap.id}>
                        <td style={{ color: '#888', fontSize: 13 }}>{ap.category}</td>
                        <td style={{ fontWeight: 500 }}>{ap.name}</td>
                        <td>
                          <input
                            type="text"
                            value={audienceProfileTrans[ap.id] || ''}
                            dir="rtl"
                            onChange={e => setAudienceProfileTrans(prev => ({ ...prev, [ap.id]: e.target.value }))}
                            style={!audienceProfileTrans[ap.id] ? missingInputStyle : inputStyle}
                            placeholder={t('missingTranslation')}
                          />
                        </td>
                        <td>
                          <button className="admin-delete-btn" onClick={() => handleDeleteAudienceProfile(ap.id)} title="Delete">
                            🗑
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                  <tr className="admin-add-row">
                    <td>
                      <select
                        value={newAudienceProfile.category}
                        onChange={e => setNewAudienceProfile(prev => ({ ...prev, category: e.target.value }))}
                        style={inputStyle}
                      >
                        <option value="">{t('categoryLabel')}</option>
                        {AUDIENCE_CATEGORIES.map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="text"
                        value={newAudienceProfile.name}
                        onChange={e => setNewAudienceProfile(prev => ({ ...prev, name: e.target.value }))}
                        placeholder={t('englishName')}
                        style={inputStyle}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={newAudienceProfile.nameHe}
                        dir="rtl"
                        onChange={e => setNewAudienceProfile(prev => ({ ...prev, nameHe: e.target.value }))}
                        placeholder={t('hebrewName')}
                        style={inputStyle}
                      />
                    </td>
                    <td>
                      <button
                        className="admin-add-btn"
                        onClick={handleAddAudienceProfile}
                        disabled={adding || !newAudienceProfile.name.trim() || !newAudienceProfile.nameHe.trim() || !newAudienceProfile.category}
                      >
                        {t('add')}
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={handleSaveAudienceProfiles}
                disabled={contentSaving}
                className="ase-btn-save"
              >
                {contentSaving ? <><Loader variant="button" className="loader-light" /> {t('saving', { ns: 'common' })}</> : t('saveChanges')}
              </button>
            </div>
          </>
        )
      )}
    </div>
  );
}
