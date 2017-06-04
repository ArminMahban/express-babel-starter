import dotenv from 'dotenv';
import botkit from 'botkit';
import Yelp from 'yelp';
import GoogleMapsAPI from 'googlemaps';

dotenv.config({ silent: true });

const yelp = new Yelp({
  consumer_key: process.env.CONSUMER_KEY,
  consumer_secret: process.env.CONSUMER_SECRET,
  token: process.env.TOKEN,
  token_secret: process.env.TOKEN_SECRET,
});

const publicConfig = {
  key: process.env.GMAP_KEY,
  stagger_time: 1000, // for elevationPath
  encode_polylines: false,
  secure: true, // use https
};
const gmAPI = new GoogleMapsAPI(publicConfig);
let dest = '2090 Broadway, Upper West Side, New York, NY 10023';

// initialize

const controller = botkit.slackbot({
  debug: false,
});

// initialize slackbot
const slackbot = controller.spawn({
  token: process.env.SLACK_BOT_TOKEN,
  // this grabs the slack token we exported earlier
}).startRTM((err) => {
  // start the real time message client
  if (err) { throw new Error(err); }
});

controller.setupWebserver(process.env.PORT || 3001, (err, webserver) => {
  controller.createWebhookEndpoints(webserver, slackbot, () => {
    if (err) { throw new Error(err); }
  });
});


controller.on('direct_message', (bot, message) => {
  if (!message.text.match(/(help|hungry|dinner|food|directions)$/)) {
    bot.reply(message, 'Let me know when you\'re hungry!');
  }
});

controller.hears(['help'], ['message_received', 'direct_message'], (bot, message) => {
  bot.reply(message, 'Hi! I\'m a food bot! \n I can recommend places to eat nearby!');
});

controller.hears(['hungry', 'dinner', 'food'], ['message_received', 'direct_message'], (bot, message) => {
  const askFlavor = function (err, convo) {
    convo.ask('What kind of food would you like? (ex: \'sushi\' or \'Italian\')', (response, convo) => {
      askSize(response, convo);
      convo.next();
    }, {
      key: 'food',
    });
  };
  let askSize = function (response, convo) {
    convo.ask('Where are you? (ex: Hanover, NH)', (response, convo) => {
      convo.say('Ok! One moment. Searching restaurants...');
      yelp.search({
        term: convo.extractResponse('food'),
        location: convo.extractResponse('location'),
        limit: 1,
      })
        .then((data) => {
          const replies = parseJson(data);
          replies.forEach((reply) => {
            bot.reply(message, reply);
          });
          convo.stop();
        })
        .catch((err) => {
          bot.reply(message, 'Oops, something went wrong');
          console.error(err);
        });
    }, {
      key: 'location',
    });
  };

  bot.startConversation(message, askFlavor);
});

controller.hears('directions', ['message_received', 'direct_message'], (bot, message) => {
  console.log(dest);
  bot.createConversation(message, (err, convo) => {
    convo.ask('What\'s your starting address?', (response, convo) => {
      bot.reply(message, 'Ok, fetching directions');
      const params = {
        origin: convo.extractResponse('start_location'),
        destination: dest,
        mode: 'driving',
        key: 'AIzaSyCRXmovu0xSQKoQgeaMDLz1MimhoZaYY54',
      };
      gmAPI.directions(params, (err, data) => {
        let resultStr = '';
        data.routes[0].legs[0].steps.forEach((step) => {
          const distance = step.distance.text;
          const duration = step.duration.text;
          const direction = step.html_instructions.replace(/<(?:.|\n)*?>/gm, '');
          resultStr += `*${direction}*` + ` for ${distance} (${duration})\n`;
        });
        bot.reply(message, resultStr);
        convo.stop();
      });
    }, {
      key: 'start_location',
    });
    convo.activate();
  });
});

    /**
      Parses the yelp response json
      @param {json} data json from http response
      @return {array} an array of message objects representing the requested restaurants
    */
function parseJson(data) {
  const replies = [];
  data.businesses.forEach((business) => {
    let openStr = 'Yes';
    if (business.is_closed) {
      openStr = 'No';
    }
    console.log(business.location);
    console.log(business.location.address);
    dest = business.location.address[0];
    const reply = {
      attachments: [{
        title: business.name,
        title_link: business.url,
        text: business.snippet_text,
        image_url: business.image_url,
        color: '#F35A00',
        fields: [{
          title: 'Rating',
          value: `${business.rating} stars`,
          short: true,
        }, {
          title: 'Open?',
          value: openStr,
          short: true,
        }, {
          title: 'Number',
          value: business.display_phone,
          short: true,
        }, {
          title: 'Location',
          value: dest,
          short: true,
        }],
        actions: [{
          name: 'directions',
          text: 'Get Directions',
          type: 'button',
          value: business.name,
        }],
      }],
    };
    replies.push(reply);
  });
  return replies;
}
