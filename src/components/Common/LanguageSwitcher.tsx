import { useTranslation } from 'react-i18next';

const languages = [
  { code: 'en', label: 'EN', name: 'English' },
  { code: 'ja', label: 'JA', name: '日本語' },
  { code: 'zh', label: 'ZH', name: '中文' },
] as const;

export function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    i18n.changeLanguage(e.target.value);
  };

  return (
    <select
      value={i18n.language}
      onChange={handleChange}
      className="rounded bg-transparent px-1 py-1 text-xs font-medium text-gray-400 hover:bg-gray-700 hover:text-white cursor-pointer focus:outline-none"
    >
      {languages.map((lang) => (
        <option key={lang.code} value={lang.code} className="bg-gray-800 text-gray-300">
          {lang.label} - {lang.name}
        </option>
      ))}
    </select>
  );
}
