// @ts-nocheck
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const extractProps = (scriptContent) => {
// 解析 script 内容为 AST
const ast = parser.parse(scriptContent, {
  sourceType: 'module',
  plugins: ['jsx']
});

// 用于存储最终结果的数组
const propsArray = [];

// 遍历 AST
traverse(ast, {
  // 找到 export default 节点
  ExportDefaultDeclaration({ node }) {
    const properties = node.declaration.properties;
    for (const prop of properties) {
      // 找到 props 对象
      if (prop.key.name === 'props' && prop.value.type === 'ObjectExpression') {
        for (const propItem of prop.value.properties) {
          const propData = {
            label: propItem.key.name,
            description: '',
            detail: ''
          };

          // 提取注释为 description
          if (propItem.leadingComments && propItem.leadingComments.length > 0) {
            propData.description = propItem.leadingComments
              .map(comment => comment.value.trim())
              .join('\n');
          }

          // 提取 type 值作为 value
          if (propItem.value.type === 'ObjectExpression') {
            for (const subProp of propItem.value.properties) {
              if (subProp.key.name === 'type' && (subProp.value.type === 'Identifier' || subProp.value.type === 'ArrayExpression')) {
                if(subProp.value.type === 'Identifier'){
                  propData.detail = subProp.value.name;
                }
                else if(subProp.value.type === 'ArrayExpression'){
                  propData.detail = subProp.value.elements.map(item=>(item.name))
                }
              }
            }
          }

          propsArray.push(propData);
        }
      }
    }
  }
});


  return propsArray;
};

module.exports = {
  extractProps
}
