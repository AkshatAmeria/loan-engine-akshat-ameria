
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");


const s3Client = new S3Client({});

exports.getUploadUrl = async (event) => { 
  const bucket = process.env.BUCKET_NAME;
  const key = `uploads/${Date.now()}_users.csv`;

  // put
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: 'text/csv'
  });

  try {
    // Generate the Presigned URL
    const url = await getSignedUrl(s3Client, command, { expiresIn: 300 });

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ uploadUrl: url, key: key })
    };
  } catch (error) {
    console.error("Error generating URL:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};