; case display-045-arraytostr
; expect exit=0 stdout="[\"a\\nb\"]\n"
.func main arity=0 locals=0
  PUSH_STR "a\nb"
  NEW_ARRAY 1
  TOSTR
  PRINT
  RET
.end
