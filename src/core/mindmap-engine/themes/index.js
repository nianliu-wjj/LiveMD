import darkList from './dark/index'
import lightList from './light/index'

const themeList = [...darkList, ...lightList]

// 主题扩展插件
const Themes = {
  darkList,
  lightList,
  init(MindMap) {
    themeList.forEach(item => {
      MindMap.defineTheme(item.value, item.theme)
    })
  },
  remove(MindMap) {
    themeList.forEach(item => {
      MindMap.removeTheme(item.value)
    })
  }
}

export default Themes
