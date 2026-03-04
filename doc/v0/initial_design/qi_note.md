
我在设想这么一个流程,
1. web skill的这个meta skill，一开始我们基于我们的best knowledge写一个流程,
2. 我们先挑一百个网站，然后在构建per-website-skill的过程中,每一个其实都是一个例子,搞出来的过程中有些知识是meta skill里没有的，搞完了之后再去update这个meta skill。这样，在构建每个web skill的时候，meta skill自己在self-evolve。


另外就是，最好在这个最初的explore&record阶段，最好也先不需要人，先直接用agent自己的browser-use capability(借助一些已有的开源tool?)，自己看a11y或者screenshot，来navigate website，模拟一些task的流程。只有少数agent不能搞定的task，才需要最终人来接管来完成。


- 可以做一个open-api-key，或者叫api-key-skill，专门让agent去注册和获得api key的，这样其实拿到api key以后，就不用mcp了，就直接用api就行了。这个应该是所有网站都欢迎的。
- 默认可以用固定script获得openrouter上的免费model(或者别的提供免费model api的网站接口)，这样可以有一个model来bootstrap别的api key的获取。