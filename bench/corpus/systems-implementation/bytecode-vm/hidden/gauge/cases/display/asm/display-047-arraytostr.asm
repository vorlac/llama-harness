; case display-047-arraytostr
; expect exit=0 stdout="[\"q\\\"q\"]\n"
.func main arity=0 locals=0
  PUSH_STR "q\"q"
  NEW_ARRAY 1
  TOSTR
  PRINT
  RET
.end
