import { useTranslation } from 'react-i18next';

const languages = ['en', 'ja', 'zh'] as const;
type Language = (typeof languages)[number];

const languageLabels: Record<Language, string> = {
  en: 'EN',
  ja: 'JA',
  zh: 'ZH',
};

const languageNames: Record<Language, string> = {
  en: 'English',
  ja: '日本語',
  zh: '中文',
};

export function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const currentLang = (languages.includes(i18n.language as Language)
    ? i18n.language
    : 'en') as Language;

  const toggleLanguage = () => {
    const currentIndex = languages.indexOf(currentLang);
    const nextIndex = (currentIndex + 1) % languages.length;
    i18n.changeLanguage(languages[nextIndex]);
  };

  const nextLang = languages[(languages.indexOf(currentLang) + 1) % languages.length];

  return (
    <button
      onClick={toggleLanguage}
      className="rounded px-2 py-1 text-xs font-medium text-gray-400 hover:bg-gray-700 hover:text-white"
      title={`Switch to ${languageNames[nextLang]}`}
    >
      {languageLabels[currentLang]}
    </button>
  );
}
