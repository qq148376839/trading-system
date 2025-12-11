import type { ThemeConfig } from 'antd';

/**
 * Ant Design 主题配置
 * 统一管理全局主题样式，降低运维成本
 */
export const antdTheme: ThemeConfig = {
  token: {
    // 主色
    colorPrimary: '#1890ff',
    colorSuccess: '#52c41a',
    colorWarning: '#faad14',
    colorError: '#ff4d4f',
    colorInfo: '#1890ff',
    
    // 字体
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
    fontSize: 14,
    
    // 圆角
    borderRadius: 6,
    
    // 间距
    wireframe: false,
  },
  components: {
    Layout: {
      bodyBg: '#f0f2f5',
      headerBg: '#001529',
      headerHeight: 64,
      headerPadding: '0 24px',
      siderBg: '#001529',
      triggerBg: '#002140',
      triggerColor: '#fff',
    },
    Menu: {
      itemBg: '#001529',
      itemColor: 'rgba(255, 255, 255, 0.65)',
      itemHoverBg: '#112240',
      itemSelectedBg: '#1890ff',
      itemSelectedColor: '#fff',
      itemActiveBg: '#112240',
      subMenuItemBg: '#000c17',
    },
    Button: {
      borderRadius: 6,
      controlHeight: 32,
    },
    Table: {
      borderRadius: 6,
    },
    Card: {
      borderRadius: 6,
    },
  },
};

