package nl.inl.corpuswebsite.utils.analyseUtils;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.DecimalFormat;
import java.util.*;
import java.util.stream.Collectors;

/**
 * ClassName: BlacklabUtilsForAnalyse
 * Package: nl.inl.corpuswebsite.utils.analyseUtils
 * Description: It is used to connect blacklab-server and get the information from the corpus through blacklab-server.
 */
public class BlacklabUtilsForAnalyse {
    private String BASE_URL; // base url connecting to blacklab-server, eg. http://localhost:8084/blacklab-server/

    public BlacklabUtilsForAnalyse(String BASE_URL)
    {
        this.BASE_URL = BASE_URL.endsWith("/") ? BASE_URL : BASE_URL + "/";
    }

    // 过滤不可读字符，只留汉字、字母、数字、空格
    private static String keepPrintable(String raw) {
        if (raw == null) {
            return "";
        }
        return raw.replaceAll("[^\\p{L}\\p{N}\\s]", " ")  // 清掉不可读
                .replaceAll("\\s{2,}", " ")            // 多空格压成一个
                .trim();
    }

    /** query the "documentCount" param of a corpus, which means how many documents the corpus have.
     * @param corpusName the name of corpus
     * @return int documentCount
     */
    public int getDocumentCount(String corpusName) throws Exception {
        String url = this.BASE_URL + corpusName + "?outputformat=json";
        JSONObject response = fetch(url);
        return Integer.parseInt(response.get("documentCount").toString());
    }

    /** query the docPids of a corpus,
     * @param corpusName the name of corpus
     * @return List < String > the list of docPid
     */
    public List<String> getDocPids(String corpusName) throws Exception {
        String url = this.BASE_URL + corpusName + "/docs?number="+getDocumentCount(corpusName)+"&outputformat=json";
        JSONObject response = fetch(url);
        JSONArray docsArray = response.getJSONArray("docs");

        List<String> docPids = new ArrayList<>();
        for (int i = 0; i < docsArray.size(); i++) {
            JSONObject docObject = docsArray.getJSONObject(i); // 获取每个文档对象
            String docPid = docObject.getString("docPid"); // 提取 docPid
            docPids.add(docPid); // 添加到 List 中
        }

        return docPids;
    }


    /** query the "tokenCount" param of a corpus, which means how many tokens the corpus have.
     * @param corpusName the name of corpus
     * @return int tokenCount
     */
    public int getTokenCount(String corpusName) throws Exception {
        String url = BASE_URL + corpusName + "?outputformat=json";
        JSONObject response = fetch(url);
        return Integer.parseInt(response.get("tokenCount").toString());
    }

    /** query the "tokenCount" param of a document, which means how many tokens the document have.
     * @param corpusName the name of corpus
     * @param docId the id of document, 0-based.
     * @return int tokenCount
     */
    public int getDocTokenCount(String corpusName, String docId) throws Exception {
        String url = BASE_URL + corpusName +"/docs/" + docId +"?outputformat=json";
        JSONObject response = fetch(url);
        return response.getJSONObject("docInfo").getJSONArray("tokenCounts").getJSONObject(0).getIntValue("tokenCount");
    }

    /** query the content of the corpus, and return tokens in the form of a one-dimensional array
     * @param corpusName the name of corpus
     * @param stopwords the word that will be ignored in the result
     * @param isCase If isCase == True, it means using "word" that means case and inflected forms are sensitive; else If isCase == False, it means using "lemma" that means case and inflected forms are not sensitive
     * @return a one-dimensional array. the tokens in the form of a one-dimensional array, and each element is a token
     */
    public List<String> getAllContentLinear(String corpusName, List<String> stopwords, Boolean isCase) throws Exception {
        List<String> allPlainList = new ArrayList<>();
        List<String> docPids = getDocPids(corpusName);

        for (String docPid: docPids) {
            List<String> plainList = getContentFromDoc(corpusName, stopwords, isCase, docPid);
            allPlainList.addAll(plainList);
        }

        return allPlainList;
    }

    /** query the content of the corpus, and return tokens in the form of a two-dimensional array
     * @param corpusName the name of corpus
     * @param stopwords the word that will be ignored in the result
     * @param isCase If isCase == True, it means using "word" that means case and inflected forms are sensitive; else If isCase == False, it means using "lemma" that means case and inflected forms are not sensitive
     * @return a two-dimensional array. Each element in the two-dimensional array is a document, and each element in a document is a token
     */
    public List<List<String>> getAllContent(String corpusName, List<String> stopwords, Boolean isCase) throws Exception {
        List<List<String>> allPlainList = new ArrayList<>();
        List<String> docPids = getDocPids(corpusName);

        for (String docPid: docPids) {
            List<String> plainList = getContentFromDoc(corpusName, stopwords, isCase, docPid);
            allPlainList.add(plainList);
        }

        return allPlainList;
    }

    /** query the termFreq of a corpus, including absolute frequency and relative frequency of each token. The function uses the "hits" api.
     * @param corpusName the name of corpus
     * @param isCase If isCase == True, it means using "word" that means case and inflected forms are sensitive; else If isCase == False, it means using "lemma" that means case and inflected forms are not sensitive
     * @param number  the number of top words with the highest frequency
     * @param stopwords the word that will be ignored in the result
     * @return JSONArray wordFreqArray, including word("word" or "lemma"), termFreq, relativeFreq and source(corpusName)
     */
    public JSONArray getTermfreq(String corpusName, Boolean isCase, int number, List<String> stopwords)  throws Exception {
        String wordOrLemma = isCase ? "word" : "lemma";
        int queryNumber = number + stopwords.size() + 100;
        String url = this.BASE_URL + corpusName + "/hits?patt=%5B%5D&group=hit:"+ wordOrLemma +"&number="+ queryNumber +"&outputformat=json";
        JSONObject response = fetch(url);
        JSONArray hitGroupsArray = response.getJSONArray("hitGroups");

        // get the tokenCount of the corpus
        int tokenCount = getTokenCount(corpusName);
        // the array that stores some information and will be returned
        JSONArray wordFreqArray = new JSONArray();
        // a DecimalFormat object, to format the relativeFreq
        DecimalFormat df = new DecimalFormat("0.000000");
        for (int i = 0; i < hitGroupsArray.size(); i++) {
            JSONObject hitGroup = hitGroupsArray.getJSONObject(i);
            String identityDisplay = hitGroup.getString("identityDisplay");

            // 过滤不可读字符
            identityDisplay = keepPrintable(identityDisplay);
            if (identityDisplay.isEmpty()) {          // 洗成空串直接跳过
                continue;
            }

            // identityDisplay(the word)is in stopwords List, continue the loop
            if (stopwords.contains(identityDisplay)) {
                continue;
            }

            int size = hitGroup.getIntValue("size");
            double relativeFreq = (double) size / tokenCount;
            // format the relative frequency as a percentage and round it to two decimal places
            String formattedRelativeFreq = df.format(relativeFreq * 100) + "%";
            JSONObject wordFreqObj = new JSONObject();
            wordFreqObj.put("word", identityDisplay);
            wordFreqObj.put("absoluteFreq", size);
            wordFreqObj.put("relativeFreq", formattedRelativeFreq);
            wordFreqObj.put("source", corpusName);
            wordFreqArray.add(wordFreqObj);

            // when we have enough element of wordFreq, end the loop
            if (wordFreqArray.size() == number) {
                break;
            }
        }

        return wordFreqArray;
    }

    /** query the termFreq of a corpus, including absolute frequency and relative frequency of each token. The function uses the "hits" api.
     * @param corpusName the name of corpus
     * @param isCase If isCase == True, it means using "word" that means case and inflected forms are sensitive; else If isCase == False, it means using "lemma" that means case and inflected forms are not sensitive
     * @param tokens  the list of words or lemmas
     * @return Map < String, Integer > tokensTermfreq. The key is word or lemma, and the value is the termfreq of word or lemma
     */
    public Map<String, Integer> getTokensTermfreq(String corpusName, Boolean isCase, List<String> tokens)  throws Exception {
        Map<String, Integer> tokensTermfreq = new HashMap<>();
        // if the tokens is Empty, then return a Map that is empty.
        if(tokens.isEmpty()){
            return tokensTermfreq;
        }

        String tokensStr = String.join("|", tokens);
        String wordOrLemma = isCase ? "word" : "lemma";

        String url = this.BASE_URL + corpusName +"/hits";

        Map<String, String> requestParams = new HashMap<>();
        requestParams.put("patt", "[" + wordOrLemma + "=\""+tokensStr+ "\"]" );
        requestParams.put("outputformat", "json");
        requestParams.put("group", "hit:"+wordOrLemma);

        StringBuilder requestBodyBuilder = new StringBuilder();
        for (Map.Entry<String, String> entry : requestParams.entrySet()) {
            if (requestBodyBuilder.length() > 0) {
                requestBodyBuilder.append("&");
            }
            requestBodyBuilder.append(entry.getKey())
                    .append("=")
                    .append(URLEncoder.encode(entry.getValue(), StandardCharsets.UTF_8));
        }
        String requestBody = requestBodyBuilder.toString();

        JSONObject response = sendPostRequest(requestBody, url);
        JSONArray hitGroupsArray = response.getJSONArray("hitGroups");
        // Initialize the Map tokensTermfreq. Each token in tokens as the key, and 0 as the value.
        for (String token : tokens) {
            tokensTermfreq.put(token, 0);
        }
        for (int i = 0; i < hitGroupsArray.size(); i++) {
            JSONObject hitGroup = hitGroupsArray.getJSONObject(i);
            String identityDisplay = hitGroup.getString("identityDisplay");
            int size = hitGroup.getIntValue("size");
            if (tokensTermfreq.containsKey(identityDisplay)) {
                tokensTermfreq.put(identityDisplay, tokensTermfreq.get(identityDisplay) + size);
            }
        }

        return tokensTermfreq;
    }

    /**
     * query the collocation of the keywords, using "hits" api
     *
     * @param corpusName   the name of corpus
     * @param isCase       the collocation is word(isCase==True) or lemma(isCase==False)
     * @param stopwords    the word that will be ignored in the result
     * @param number       the number of top words with the highest frequency
     * @param aroundNumber the number of word around hits (eg. aroundNumber == 3, then context=3:3)
     * @param keywordPatt  the CQL of keyword, eg. [word="(?-i)apple|banana"&lemma="(?-i)apple|banana"&pos="NN"]
     * @return JSONArray , including keyword("word" or "lemma", depend on keywordPatt), collocation("word"or"lemma" , depend on isCase), relativeFreq and source(corpusName)
     */
    public JSONArray getColloc(String corpusName, Boolean isCase, List<String> stopwords, int number, int aroundNumber, String keywordPatt) throws Exception {
        if(keywordPatt.length() == 0){
            keywordPatt = "[]";
        }
        String url = this.BASE_URL + corpusName +"/hits";

        Map<String, String> requestParams = new HashMap<>();
        requestParams.put("patt", keywordPatt);
        requestParams.put("number", String.valueOf(number));
        requestParams.put("outputformat", "json");
        requestParams.put("context", aroundNumber + ":" + aroundNumber);

        StringBuilder requestBodyBuilder = new StringBuilder();
        for (Map.Entry<String, String> entry : requestParams.entrySet()) {
            if (requestBodyBuilder.length() > 0) {
                requestBodyBuilder.append("&");
            }
            requestBodyBuilder.append(entry.getKey())
                    .append("=")
                    .append(URLEncoder.encode(entry.getValue(), StandardCharsets.UTF_8));
        }
        String requestBody = requestBodyBuilder.toString();
        int tokenCount = getTokenCount(corpusName);
        JSONObject response = sendPostRequest(requestBody, url);
        JSONArray hits = response.getJSONArray("hits");
        // The key is a unique identifier composed of a keyword and a collocation, and the value is the corresponding frequency.
        Map<String, Integer> freqMap = new HashMap<>();
        // Iterate through each element in the hits array.
        for (int i = 0; i < hits.size(); i++) {
            JSONObject hit = hits.getJSONObject(i);
            JSONObject match = hit.getJSONObject("match");
            JSONObject left = hit.getJSONObject("left");
            JSONObject right = hit.getJSONObject("right");

            // 1. 关键词安全检查 (解决 ArrayIndexOutOfBoundsException)
            JSONArray keywordArr = isCase ? match.getJSONArray("word") : match.getJSONArray("lemma");
            if (keywordArr == null || keywordArr.size() == 0) {
                continue;
            }
            String keyword = keywordArr.get(0).toString();
            // *** 在这里清洗关键词 ***
            keyword = keepPrintable(keyword);
            if (keywordArr == null || keywordArr.size() == 0) {
                continue;
            }

            JSONArray leftArr = isCase? left.getJSONArray("word") : left.getJSONArray("lemma");
            JSONArray rightArr = isCase? right.getJSONArray("word") : right.getJSONArray("lemma");

            // Combine words on the left and right to form collocations and count their frequencies.
            if (leftArr != null) {
                for (int j = 0; j < leftArr.size(); j++) {
                    String collocation = leftArr.getString(j);

                    // *** 在这里清洗搭配词 ***
                    collocation = keepPrintable(collocation);

                    if (!collocation.isEmpty()) {
                        String key = keyword + "|" + collocation;
                        freqMap.put(key, freqMap.getOrDefault(key, 0) + 1);
                    }
                }
            }
            if (rightArr != null) {
                for (int k = 0; k < rightArr.size(); k++) {
                    String collocation = rightArr.getString(k);

                    // *** 在这里清洗搭配词 ***
                    collocation = keepPrintable(collocation);

                    if (!collocation.isEmpty()) {
                        String key = keyword + "|" + collocation;
                        freqMap.put(key, freqMap.getOrDefault(key, 0) + 1);
                    }
                }
            }
        }

        DecimalFormat df = new DecimalFormat("0.000000");

        List<JSONObject> resultList = new ArrayList<>();
        for (Map.Entry<String, Integer> entry : freqMap.entrySet()) {
            String[] parts = entry.getKey().split("\\|");
            JSONObject element = new JSONObject();
            element.put("keyword", parts[0]);
            element.put("collocation", parts.length > 1? parts[1]: "");
            element.put("absoluteFreq", entry.getValue());
            double relativeFreq = (double) entry.getValue() / tokenCount;
            String formattedRelativeFreq = df.format(relativeFreq * 100) + "%";
            element.put("relativeFreq", formattedRelativeFreq);
            element.put("source", corpusName);
            resultList.add(element);
        }

        // Sort using Collections.sort combined with a custom comparator in descending order based on absoluteFreq.
        Collections.sort(resultList, (o1, o2) -> o2.getInteger("absoluteFreq") - o1.getInteger("absoluteFreq"));

        // Obtain the top number of elements excluding stopwords.
        List<JSONObject> filteredList = new ArrayList<>();
        Iterator<JSONObject> iterator = resultList.iterator();
        int count = 0;
        while (iterator.hasNext() && count < number) {
            JSONObject jsonObject = iterator.next();
            String collocation = jsonObject.getString("collocation");

            if (!stopwords.contains(collocation)) {
                filteredList.add(jsonObject);
                count++;
            }
        }

        return JSONArray.parseArray(filteredList.toString());
    }

    /**
     send GET request and return the response
     */
    protected JSONObject fetch(String url) throws Exception {
        // Read from the specified URL.
        InputStream is = new URL(url).openStream();
        try {
            String line;
            BufferedReader br = new BufferedReader(new InputStreamReader(is));
            StringBuilder b = new StringBuilder();
            while ((line = br.readLine()) != null) {
                b.append(line);
            }
            return JSON.parseObject(b.toString());
        } finally {
            is.close();
        }
    }

    /**
     send POST request and return the response
     */
    public static JSONObject sendPostRequest(String requestBody, String url) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded;charset=utf-8");
        // 修正：计算的是 UTF-8 编码后的字节数
        byte[] requestBodyBytes = requestBody.getBytes(StandardCharsets.UTF_8);
        connection.setRequestProperty("Content-Length", String.valueOf(requestBodyBytes.length));

        try (OutputStream os = connection.getOutputStream()) {
            os.write(requestBodyBytes);
        }

        int responseCode = connection.getResponseCode();
        if (responseCode == HttpURLConnection.HTTP_OK) {
            StringBuilder responseBuilder = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    responseBuilder.append(line);
                }
            }
            return JSON.parseObject(responseBuilder.toString());
        } else {
            throw new RuntimeException("HTTP request ERROR: " + responseCode);
        }
    }

    /** query the content from a document using the "Document snippet" API.
     * @param corpusName the name of corpus
     * @param stopwords the word that will be ignored in the result
     * @param isCase If isCase == True, it means using "word" that means case and inflected forms are sensitive; else If isCase == False, it means using "lemma" that means case and inflected forms are not sensitive
     * @param docId the id of the document
     * @return List<String> the content of the document
     */
    protected List<String> getContentFromDoc(String corpusName, List<String> stopwords, Boolean isCase, String docId) throws Exception {
        String url = this.BASE_URL + corpusName + "/docs/" +docId+ "?outputformat=json";
        String tokenCount = fetch(url).getJSONObject("docInfo").getJSONArray("tokenCounts").getJSONObject(0).getString("tokenCount");
        url = this.BASE_URL + corpusName + "/docs/" +docId+ "/snippet?wordstart=0&wordend="+ tokenCount +"&outputformat=json";
        JSONObject response = fetch(url);
        JSONObject matches = response.getJSONObject("match");
        // If isCase == True, it means using word; If false, it means using lemma
        JSONArray selectedWordsArray = isCase ? matches.getJSONArray("word") : matches.getJSONArray("lemma");

        List<String> selectedWords = selectedWordsArray.stream()
                .map(Object::toString)
                .map(word -> keepPrintable(word))
                .filter(word -> !word.isEmpty() && !word.equals(" "))
                .filter(word -> !stopwords.contains(word))
                .collect(Collectors.toList());

        return selectedWords;
    }

    /**
     * query the cooccurWord of the keywords, using "hits" api
     *
     * @param corpusName   the name of corpus
     * @param isCase       the collocation is word(isCase==True) or lemma(isCase==False)
     * @param stopwords    the word that will be ignored in the result
     * @param number       the number of top words with the highest frequency
     * @param keywordPatt  the CQL of keyword, eg. [word="(?-i)apple|banana"&lemma="(?-i)apple|banana"&pos="NN"]
     * @param edgeAlg  the algorithm of edge, Jaccard or Simpson, and now on a document basis.
     * @return JSONArray , including keyword("word" or "lemma", depend on keywordPatt), cooccurWord("word"or"lemma" , depend on isCase), absoluteFreq,  relativeFreq and source(corpusName)
     */
    public JSONArray getCooccur(String corpusName, Boolean isCase, List<String> stopwords, int number, String keywordPatt, String edgeAlg) throws Exception {
        if(keywordPatt.length() == 0){
            keywordPatt = "[]";
        }

        int docNum = getDocumentCount(corpusName);
        List<String> theDocPids = getDocPids(corpusName);
        int maxTokenCount = 0;
        for(String docPid: theDocPids){
            maxTokenCount = Math.max(getDocTokenCount(corpusName, docPid), maxTokenCount);
        }
        int aroundNumber = maxTokenCount;

        String url = this.BASE_URL + corpusName +"/hits";

        Map<String, String> requestParams = new HashMap<>();
        requestParams.put("patt", keywordPatt);
        requestParams.put("number", String.valueOf(number));
        requestParams.put("outputformat", "json");
        requestParams.put("context", aroundNumber+":"+aroundNumber);

        StringBuilder requestBodyBuilder = new StringBuilder();
        for (Map.Entry<String, String> entry : requestParams.entrySet()) {
            if (requestBodyBuilder.length() > 0) {
                requestBodyBuilder.append("&");
            }
            requestBodyBuilder.append(entry.getKey())
                    .append("=")
                    .append(URLEncoder.encode(entry.getValue(), StandardCharsets.UTF_8));
        }
        String requestBody = requestBodyBuilder.toString();

        int tokenCount = getTokenCount(corpusName);
        JSONObject response = sendPostRequest(requestBody, url);
        JSONArray hits = response.getJSONArray("hits");

        // The key is a unique identifier composed of a keyword and a collocation, and the value is the corresponding frequency.
        Map<String, Integer> freqMap = new HashMap<>();
        // The key is a unique identifier composed of a keyword and a collocation, and the value is the docId of their occur.
        Map<String, Set<String>> composeDocMap = new HashMap<>();
        // The key is keyword, and the value is the docId of its occur.
        Map<String, Set<String>> keywordDocMap = new HashMap<>();
        // Iterate through each element in the hits array.
        for (int i = 0; i < hits.size(); i++) {
            JSONObject hit = hits.getJSONObject(i);
            JSONObject match = hit.getJSONObject("match");
            JSONObject left = hit.getJSONObject("left");
            JSONObject right = hit.getJSONObject("right");
            String docId = hit.getString("docPid");

            String keyword = isCase? match.getJSONArray("word").get(0).toString() : match.getJSONArray("lemma").get(0).toString();
            // Check if there is already an entry for the keyword in the map
            Set<String> docIds = keywordDocMap.get(keyword);
            if (docIds == null) {
                docIds = new HashSet<>();
                docIds.add(docId);
                keywordDocMap.put(keyword, docIds);
            } else {
                docIds.add(docId);
            }

            JSONArray leftArr = isCase? left.getJSONArray("word") : left.getJSONArray("lemma");
            JSONArray rightArr = isCase? right.getJSONArray("word") : right.getJSONArray("lemma");

            // Combine words on the left and right to form collocations and count their frequencies.
            for (int j = 0; j < leftArr.size(); j++) {
                String cooccurWord = leftArr.getString(j);
                String key = keyword + "|" + cooccurWord;
                freqMap.put(key, freqMap.getOrDefault(key, 0) + 1);
                Set<String> ids = composeDocMap.get(key);
                if (ids == null) {
                    ids = new HashSet<>();
                    ids.add(docId);
                    composeDocMap.put(key, ids);
                } else {
                    ids.add(docId);
                }
            }
            for (int k = 0; k < rightArr.size(); k++) {
                String cooccurWord = rightArr.getString(k);
                String key = keyword + "|" + cooccurWord;
                freqMap.put(key, freqMap.getOrDefault(key, 0) + 1);
                Set<String> ids = composeDocMap.get(key);
                if (ids == null) {
                    ids = new HashSet<>();
                    ids.add(docId);
                    composeDocMap.put(key, ids);
                } else {
                    ids.add(docId);
                }
            }
        }
        DecimalFormat df = new DecimalFormat("0.000000");

        List<JSONObject> resultList = new ArrayList<>();
        for (Map.Entry<String, Integer> entry : freqMap.entrySet()) {
            String[] parts = entry.getKey().split("\\|");
            JSONObject element = new JSONObject();
            element.put("keyword", parts[0]);
            element.put("cooccurWord", parts.length > 1? parts[1]: "");
            element.put("absoluteFreq", entry.getValue());
            double relativeFreq = (double) entry.getValue() / tokenCount;
            String formattedRelativeFreq = df.format(relativeFreq * 100) + "%";
            element.put("relativeFreq", formattedRelativeFreq);
            element.put("source", corpusName);
            resultList.add(element);
        }

        // Sort using Collections.sort combined with a custom comparator in descending order based on absoluteFreq.
        Collections.sort(resultList, (o1, o2) -> o2.getInteger("absoluteFreq") - o1.getInteger("absoluteFreq"));

        Set<String> cooccurWords = new HashSet<>();
        // Obtain the top number of elements excluding stopwords.
        List<JSONObject> filteredList = new ArrayList<>();
        Iterator<JSONObject> iterator = resultList.iterator();
        int count = 0;
        while (iterator.hasNext() && count < number) {
            JSONObject jsonObject = iterator.next();
            String cooccurWord = jsonObject.getString("cooccurWord");
            String keyword = jsonObject.getString("keyword");

            if (!stopwords.contains(cooccurWord) && !stopwords.contains(keyword)) {
                filteredList.add(jsonObject);
                cooccurWords.add(cooccurWord);
                count++;
            }
        }

        // compute the edgeAlg
        Map<String, Set<String>> cooccurDocMap = new HashMap<>();
        for (String cooccurWord : cooccurWords) {
            cooccurDocMap.put(cooccurWord, new HashSet<>());
        }

        List<String> docPids = getDocPids(corpusName);
        for (String docPid: docPids) {
            List<String> plainList = getContentFromDoc(corpusName, stopwords, isCase, docPid);
            for (String word : plainList) {
                if (cooccurWords.contains(word)) {
                    cooccurDocMap.get(word).add(docPid);
                }
            }
        }

        for (JSONObject jsonObject : filteredList) {
            String keyword = jsonObject.getString("keyword");
            String cooccurWord = jsonObject.getString("cooccurWord");
            String compose = keyword + "|" + cooccurWord;

            Set<String> keywordSet = keywordDocMap.get(keyword);
            int keywordDocCount = (keywordSet != null) ? keywordSet.size() : 0;
            Set<String> cooccurSet = cooccurDocMap.get(cooccurWord);
            int cooccurDocCount = (cooccurSet != null) ? cooccurSet.size() : 0;
            Set<String> composeSet = composeDocMap.get(compose);
            int composeDocCount = (composeSet != null) ? composeSet.size() : 0;

            int countA = Math.max(composeDocCount, 0);  // the count of document of containing keyword and coocurword at the same time
            int countB = Math.max(keywordDocCount - composeDocCount, 0);  // the count of document of only containing keyword
            int countC = Math.max(cooccurDocCount - composeDocCount, 0);  // the count of document of only containing cooccurword
            if (Objects.equals(edgeAlg, "Jaccard")) {
                double jaccardCoefficient = (countA > 0) ? (double) countA / (countA + countB + countC) : 0.0;
                String formattedEdgeWeight = df.format(jaccardCoefficient * 100) + "%";
                jsonObject.put("edgeWeight", formattedEdgeWeight);
            } else if(Objects.equals(edgeAlg, "Simpson"))
            {
                double simpsonCoefficient = (countA > 0) ? (double) countA / Math.min(countA + countB, countA + countC) : 0.0;
                String formattedEdgeWeight = df.format(simpsonCoefficient * 100) + "%";
                jsonObject.put("edgeWeight", formattedEdgeWeight);
            }

        }

        return JSONArray.parseArray(filteredList.toString());
    }


    /**
     * query the edge of cooccur network, using "hits" api
     *
     * @param corpusName the name of corpus
     * @param isCase     the collocation is word(isCase==True) or lemma(isCase==False)
     * @param stopwords  the word that will be ignored in the result
     * @param keywords   the CQL of keyword, eg. [word="(?-i)apple|banana"&lemma="(?-i)apple|banana"&pos="NN"]
     * @param edgeAlg    the algorithm of edge, Jaccard or Simpson
     * @param scope      the scope of cooccur
     * @param weightThreshold weight threshold, if weight > weightThreshold, it will be saved
     * @return JSONArray , including keyword("word" or "lemma", depend on keywordPatt), collocation("word"or"lemma" , depend on isCase), relativeFreq and source(corpusName)
     */
    public JSONArray getCooccurNetworkEdge(String corpusName, Boolean isCase, List<String> stopwords, List<String> keywords, String edgeAlg, String scope, float weightThreshold

    ) throws Exception {
        String keywordPatt;
        String wordOrLemma = isCase ? "word" : "lemma";
        String withinScope = "";
        if (Objects.equals(scope, "sentence")) {
            withinScope = " within <s/>";
        } else if(Objects.equals(scope, "paragraph")){
            withinScope = " within <p/>";
        }
        if(keywords.isEmpty()){
            keywordPatt = "[]";
        } else {
            keywordPatt = "[" + wordOrLemma + "='" + String.join("|", keywords) + "']" + withinScope;
        }

        JSONArray edgeArray = getCooccur(corpusName, isCase, stopwords, getDocumentCount(corpusName), keywordPatt, edgeAlg);

        JSONArray filterArray = new JSONArray();
        for (Object obj : edgeArray) {
            JSONObject wordJson = (JSONObject) obj;
            String word = wordJson.getString("keyword");
            String cooccurWord = wordJson.getString("cooccurWord");
            String edgeWeight = wordJson.getString("edgeWeight");
            if (!stopwords.contains(word) && !stopwords.contains(cooccurWord) && Float.parseFloat(edgeWeight.replace("%", "")) / 100 >= weightThreshold) {
                int absoluteFreq = wordJson.getIntValue("absoluteFreq");
                String relativeFreq = wordJson.getString("relativeFreq");
                JSONObject newObj = new JSONObject();
                newObj.put("keyword", word);
                newObj.put("absoluteFreq", absoluteFreq);
                newObj.put("relativeFreq", relativeFreq);
                newObj.put("cooccurWord", cooccurWord);
                newObj.put("edgeWeight", edgeWeight);
                filterArray.add(newObj);
            }
        }

        return edgeArray;
    }

}
