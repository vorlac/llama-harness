; case compare-128-gtstr
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_STR "abc"
  PUSH_STR "abd"
  GT
  PRINT
  RET
.end
