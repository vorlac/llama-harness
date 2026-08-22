; case compare-123-gtstr
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_STR ""
  PUSH_STR "a"
  GT
  PRINT
  RET
.end
