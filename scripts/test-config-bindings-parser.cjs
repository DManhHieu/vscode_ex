const { parseConfigBindingsFromSource } = require('../out/spring/parsing/configBindingsParser');
const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readSample(relativePath) {
  return fs.readFileSync(path.join(__dirname, '../test-samples/spring-boot-sample', relativePath), 'utf8');
}

function hasBinding(bindings, propertyKey, memberName) {
  return bindings.some((b) => b.propertyKey === propertyKey && b.memberName === memberName);
}

const appConfigBindings = parseConfigBindingsFromSource(readSample('src/main/java/com/example/demo/config/AppConfig.java'));
assert(hasBinding(appConfigBindings, 'spring.datasource.url', 'datasourceUrl'), '@Value field binding with default');

const schedulerBindings = parseConfigBindingsFromSource(
  readSample('src/main/java/com/example/demo/config/SchedulerConfig.java')
);
assert(hasBinding(schedulerBindings, 'app.cron', 'scheduledTask'), '@Scheduled cron binding');

const mailBindings = parseConfigBindingsFromSource(
  readSample('src/main/java/com/example/demo/config/MailProperties.java')
);
assert(
  mailBindings.some((b) => b.kind === 'configurationProperties' && b.propertyKey === 'app.mail.host'),
  '@ConfigurationProperties field binding'
);

const multiKeySource = `
@Component
public class MultiProps {
  @Scheduled(cron = "\${job.cron}", zone = "\${job.zone}")
  public void run() {}
}
`;
const multiBindings = parseConfigBindingsFromSource(multiKeySource);
assert(hasBinding(multiBindings, 'job.cron', 'run'), 'first placeholder in annotation');
assert(hasBinding(multiBindings, 'job.zone', 'run'), 'second placeholder in annotation');

console.log('OK  config bindings parser');
