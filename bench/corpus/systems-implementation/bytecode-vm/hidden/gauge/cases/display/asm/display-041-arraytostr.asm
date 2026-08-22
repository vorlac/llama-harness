; case display-041-arraytostr
; expect exit=0 stdout="[\"a\"]\n"
.func main arity=0 locals=0
  PUSH_STR "a"
  NEW_ARRAY 1
  TOSTR
  PRINT
  RET
.end
