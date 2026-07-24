/**
 * help.js — A floating "I don't understand computers" button.
 *
 * Public catalog only (index.html). Opens a modal with a plain-language
 * walkthrough aimed at someone with zero computer background: how to use
 * this catalog, how to install a program after downloading it, and how to
 * extract files from a compressed (zip/rar) folder. No jargon, no
 * assumptions — every step spells out exactly which button to press.
 */
(function (NS) {
  'use strict';

  var Dom = NS.require('ui.Dom');
  var Icons = NS.require('ui.Icons');
  var Modal = NS.require('ui.Modal');

  function step(text) {
    return Dom.h('li', { text: text, style: { 'margin-bottom': '8px', 'line-height': '1.7' } });
  }

  function sectionTitle(iconName, colorClass, text) {
    return Dom.h(
      'h3',
      {
        style: {
          display: 'flex',
          'align-items': 'center',
          gap: '10px',
          margin: '0 0 10px',
          'font-size': '1.05rem',
        },
      },
      [
        Dom.h('span.help-guide__badge.' + colorClass, {}, [
          Icons.get(iconName, { size: 20, className: 'help-guide__badge-icon' }),
        ]),
        Dom.h('span', { text: text }),
      ]
    );
  }

  function buildGuide() {
    return Dom.h('div', { style: { display: 'grid', gap: '26px' } }, [
      Dom.h('div.notice.notice--info', {}, [
        Icons.get('info'),
        Dom.h('div', {
          text:
            'המדריך הזה כתוב בשפה הכי פשוטה שיש. אין צורך להבין במחשבים כדי ' +
            'להשתמש בו — פשוט תעקבו אחרי השלבים בסדר.',
        }),
      ]),

      Dom.h('section', {}, [
        sectionTitle('search', 'help-guide__badge--blue', 'איך משתמשים בתוכנה הזו'),
        Dom.h('ol', { style: { margin: '0', 'padding-inline-start': '20px' } }, [
          step('בראש הדף יש תיבת חיפוש. מקלידים שם של תוכנה שמחפשים, והתוצאות מופיעות מיד תוך כדי הקלדה.'),
          step('אפשר גם ללחוץ על אחת התיקיות או הקטגוריות כדי לדפדף בלי לחפש.'),
          step('לוחצים על כרטיס התוכנה שמעניינת אתכם כדי לראות פרטים נוספים עליה.'),
          step('כפתור "הורדה" שומר את הקובץ אצלכם במחשב, בתיקיית ההורדות (Downloads) — זו תיקייה קבועה שתמיד קל למצוא בה קבצים שהורדתם.'),
        ]),
      ]),

      Dom.h('section', {}, [
        sectionTitle('app-window', 'help-guide__badge--green', 'איך מתקינים תוכנה שהורדתם'),
        Dom.h('ol', { style: { margin: '0', 'padding-inline-start': '20px' } }, [
          step('אחרי שההורדה הסתיימה, פותחים את תיקיית ההורדות (Downloads) ולוחצים לחיצה כפולה עם העכבר על הקובץ שהורדתם.'),
          step('לפעמים ייפתח חלון כחול של Windows שכתוב עליו "Windows protected your PC". זה תקין ולא מסוכן — לוחצים על "More info" ואז על הכפתור "Run anyway" כדי להמשיך.'),
          step('נפתח חלון התקנה. בדרך כלל אפשר פשוט ללחוץ "Next" (הבא) עד הסוף, ולבסוף על "Install" (התקן) או "Finish" (סיום).'),
          step('בסיום ההתקנה התוכנה תופיע בתפריט "התחל" (Start) של Windows, בדיוק כמו כל תוכנה אחרת במחשב.'),
        ]),
      ]),

      Dom.h('section', {}, [
        sectionTitle('archive', 'help-guide__badge--orange', 'איך מחלצים קבצים מתיקייה דחוסה (ZIP)'),
        Dom.h('p', {
          style: { margin: '0 0 10px', 'line-height': '1.7' },
          text:
            'לפעמים מה שיורד הוא לא תוכנה להתקנה, אלא "תיקייה דחוסה" — קובץ אחד ' +
            'שמכיל בתוכו כמה קבצים ביחד, כדי שיהיה קל יותר להוריד אותו. אפשר לזהות ' +
            'אותו לפי הסמל שנראה כמו תיקייה עם רוכסן.',
        }),
        Dom.h('ol', { style: { margin: '0', 'padding-inline-start': '20px' } }, [
          step('לוחצים על הקובץ הדחוס לחיצה ימנית (הכפתור הימני בעכבר).'),
          step('בתפריט שנפתח בוחרים באפשרות "Extract All..." (חילוץ הכול...).'),
          step('נפתח חלון קטן ששואל לאיזו תיקייה לחלץ את הקבצים — אפשר להשאיר את ברירת המחדל וללחוץ "Extract" (חילוץ).'),
          step('נוצרת תיקייה רגילה עם כל הקבצים בפנים, ואפשר לפתוח אותה כמו כל תיקייה אחרת.'),
        ]),
      ]),
    ]);
  }

  function openGuide() {
    Modal.open({
      title: 'מדריך שימוש פשוט',
      size: 'wide',
      body: buildGuide(),
      footer: [
        Dom.h('button.btn.btn--primary', {
          type: 'button',
          text: 'הבנתי, תודה',
          on: {
            click: function () {
              Modal.closeAll();
            },
          },
        }),
      ],
    });
  }

  var Help = {
    /** Creates the floating button once and attaches it to the page. */
    init: function () {
      var btn = Dom.h(
        'button.help-fab',
        {
          type: 'button',
          'aria-label': 'אינך מבין במחשבים? לחץ כאן לקבלת הסבר פשוט',
          title: 'אינך מבין במחשבים? לחץ כאן',
          on: { click: openGuide },
        },
        [
          Icons.get('help-circle', { className: 'help-fab__icon' }),
          Dom.h('span.help-fab__label', { text: 'אינך מבין במחשבים? לחץ כאן' }),
        ]
      );

      document.body.appendChild(btn);
      return btn;
    },
  };

  NS.define('app.Help', Help);
})(window.USBLib);
